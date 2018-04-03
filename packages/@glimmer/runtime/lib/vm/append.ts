import { Register } from '@glimmer/vm';
import { Scope, DynamicScope, Environment } from '../environment';
import { ElementBuilder } from './element-builder';
import { Option, Destroyable, Stack, LinkedList, ListSlice, Opaque, expect } from '@glimmer/util';
import { ReferenceIterator, PathReference, VersionedPathReference, combineSlice } from '@glimmer/reference';
import { LabelOpcode, JumpIfNotModifiedOpcode, DidModifyOpcode } from '../compiled/opcodes/vm';
import { VMState, ListBlockOpcode, TryOpcode, BlockOpcode, Runtime } from './update';
import RenderResult from './render-result';
import EvaluationStack from './stack';
import { WasmLowLevelVM, wasmMemory } from '@glimmer/low-level';
import { DEVMODE } from '@glimmer/local-debug-flags';
import { Context } from './gbox';
import InstructionListExecutor from './instruction-list/executor';
import InstructionListEncoder from './instruction-list/encoder';

import {
  APPEND_OPCODES,
  UpdatingOpcode,
  DebugState
} from '../opcodes';

import {
  UNDEFINED_REFERENCE
} from '../references';

import { Heap, Opcode } from "@glimmer/program";
import { RuntimeResolver } from "@glimmer/interfaces";
import { DEBUG } from '@glimmer/local-debug-flags';

export interface PublicVM {
  env: Environment;
  dynamicScope(): DynamicScope;
  getSelf(): PathReference<Opaque>;
  newDestroyable(d: Destroyable): void;
}

export type IteratorResult<T> = {
  done: false;
  value: null;
} | {
  done: true;
  value: T;
};

export interface Constants<T> {
  resolver: RuntimeResolver<T>;
  getNumber(value: number): number;
  getString(handle: number): string;
  getStringArray(value: number): string[];
  getArray(value: number): number[];
  resolveHandle<T>(index: number): T;
  getSerializable<T>(s: number): T;
}

export interface RuntimeProgram<T> {
  heap: Heap;
  constants: Constants<T>;
  opcode(offset: number): Opcode;
}

export default class VM<T> implements PublicVM {
  private dynamicScopeStack = new Stack<DynamicScope>();
  private scopeStack = new Stack<Scope>();
  private wasmVM: WasmLowLevelVM;
  private cx: Context;
  private executor: InstructionListExecutor;
  public stack: EvaluationStack;
  public instructions: InstructionListEncoder;
  public updatingOpcodeStack = new Stack<LinkedList<UpdatingOpcode>>();
  public cacheGroups = new Stack<Option<UpdatingOpcode>>();
  public listBlockStack = new Stack<ListBlockOpcode>();
  public constants: Constants<T>;
  public heap: Heap;

  /* Registers */

  // Fetch a value from a register
  fetchValue<T>(register: Register): T {
    return this.cx.decode(this.wasmVM.register(register));
  }

  // Load a value into a register
  loadValue<T>(register: Register, value: T) {
    this.wasmVM.set_register(register, this.cx.encode(value));
  }

  /**
   * Migrated to Inner
   */

  // Start a new frame and save $ra and $fp on the stack
  pushFrame() {
    this.wasmVM.push_frame();
  }

  // Jump to an address in `program`
  goto(offset: number) {
    this.wasmVM.goto(offset);
  }

  // Save $pc into $ra, then jump to a new address in `program` (jal in MIPS)
  call(handle: number) {
    this.wasmVM.call(handle);
  }

  /**
   * End of migrated.
   */

  static initial<T>(
    program: RuntimeProgram<T>,
    env: Environment,
    self: PathReference<Opaque>,
    dynamicScope: DynamicScope,
    elementStack: ElementBuilder,
    handle: number
  ) {
    let scopeSize = program.heap.scopesizeof(handle);
    let scope = Scope.root(self, scopeSize);
    let vm = new VM({ program, env }, scope, dynamicScope, elementStack);
    vm.wasmVM.set_pc(vm.heap.getaddr(handle));
    vm.updatingOpcodeStack.push(new LinkedList<UpdatingOpcode>());
    return vm;
  }

  static empty<T>(
    program: RuntimeProgram<T>,
    env: Environment,
    elementStack: ElementBuilder
  ) {
    let dynamicScope: DynamicScope = {
      get() { return UNDEFINED_REFERENCE; },
      set() { return UNDEFINED_REFERENCE; },
      child() { return dynamicScope; }
    };

    let vm = new VM({ program, env }, Scope.root(UNDEFINED_REFERENCE, 0), dynamicScope, elementStack);
    vm.updatingOpcodeStack.push(new LinkedList<UpdatingOpcode>());
    return vm;
  }

  static resume({ scope, dynamicScope }: VMState, runtime: Runtime, stack: ElementBuilder) {
    return new VM(runtime, scope, dynamicScope, stack);
  }

  constructor(
    private runtime: Runtime,
    scope: Scope,
    dynamicScope: DynamicScope,
    private elementStack: ElementBuilder,
  ) {
    this.heap = this.program.heap;
    this.constants = this.program.constants;
    this.elementStack = elementStack;
    this.scopeStack.push(scope);
    this.dynamicScopeStack.push(dynamicScope);
    let externs = {
      debugBefore: (offset: number): DebugState => {
        let opcode = new Opcode(runtime.program.heap);
        opcode.offset = offset;
        return APPEND_OPCODES.debugBefore(this, opcode, opcode.type);
      },

      debugAfter: (offset: number, state: DebugState): void => {
        let opcode = new Opcode(runtime.program.heap);
        opcode.offset = offset;
        APPEND_OPCODES.debugAfter(this, opcode, opcode.type, state);
      }
    };
    let cx = this.cx = new Context(this);
    this.executor = new InstructionListExecutor(this, elementStack, cx);
    this.wasmVM = WasmLowLevelVM.new(
      this.heap._wasmHeap(),
      APPEND_OPCODES,
      externs,
      this.cx,
      DEVMODE,
    );
    this.stack = new EvaluationStack(this.wasmVM, this.cx);
    this.instructions = new InstructionListEncoder(this.wasmVM, cx);
  }

  wasm(): WasmLowLevelVM {
    return this.wasmVM;
  }

  get program(): RuntimeProgram<Opaque> {
    return this.runtime.program;
  }

  get env(): Environment {
    return this.runtime.env;
  }

  private capture(args: number): VMState {
    return {
      dynamicScope: this.dynamicScope(),
      scope: this.scope(),
      stack: this.stack.capture(args)
    };
  }

  beginCacheGroup() {
    this.cacheGroups.push(this.updating().tail());
  }

  commitCacheGroup() {
    //        JumpIfNotModified(END)
    //        (head)
    //        (....)
    //        (tail)
    //        DidModify
    // END:   Noop

    let END = new LabelOpcode("END");

    let opcodes = this.updating();
    let marker = this.cacheGroups.pop();
    let head = marker ? opcodes.nextNode(marker) : opcodes.head();
    let tail = opcodes.tail();
    let tag = combineSlice(new ListSlice(head, tail));

    let guard = new JumpIfNotModifiedOpcode(tag, END);

    opcodes.insertBefore(guard, head);
    opcodes.append(new DidModifyOpcode(guard));
    opcodes.append(END);
  }

  enter(args: number) {
    let updating = new LinkedList<UpdatingOpcode>();

    let state = this.capture(args);
    let tracker = this.elements().pushUpdatableBlock();

    let pc = this.wasmVM.pc();
    let tryOpcode = new TryOpcode(this.heap.gethandle(pc), state, this.runtime, tracker, updating);

    this.didEnter(tryOpcode);
  }

  iterate(memo: VersionedPathReference<Opaque>, value: VersionedPathReference<Opaque>): TryOpcode {
    let stack = this.stack;
    stack.push(value);
    stack.push(memo);

    let state = this.capture(2);
    let tracker = this.elements().pushUpdatableBlock();

    // let ip = this.ip;
    // this.ip = end + 4;
    // this.frames.push(ip);

    let pc = this.wasmVM.pc();
    return new TryOpcode(this.heap.gethandle(pc), state, this.runtime, tracker, new LinkedList<UpdatingOpcode>());
  }

  enterItem(key: string, opcode: TryOpcode) {
    this.listBlock().map[key] = opcode;
    this.didEnter(opcode);
  }

  enterList(relativeStart: number) {
    let updating = new LinkedList<BlockOpcode>();

    let state = this.capture(0);
    let tracker = this.elements().pushBlockList(updating);
    let artifacts = this.stack.peek<ReferenceIterator>().artifacts;

    let pc = this.wasmVM.pc();
    let addr = (pc + relativeStart) - this.wasmVM.current_op_size();
    let start = this.heap.gethandle(addr);

    let opcode = new ListBlockOpcode(start, state, this.runtime, tracker, updating, artifacts);

    this.listBlockStack.push(opcode);

    this.didEnter(opcode);
  }

  private didEnter(opcode: BlockOpcode) {
    this.updateWith(opcode);
    this.updatingOpcodeStack.push(opcode.children);
  }

  exit() {
    this.elements().popBlock();
    this.updatingOpcodeStack.pop();

    let parent = this.updating().tail() as BlockOpcode;

    parent.didInitializeChildren();
  }

  exitList() {
    this.exit();
    this.listBlockStack.pop();
  }

  updateWith(opcode: UpdatingOpcode) {
    this.updating().append(opcode);
  }

  listBlock(): ListBlockOpcode {
    return expect(this.listBlockStack.current, 'expected a list block');
  }

  private updating(): LinkedList<UpdatingOpcode> {
    return expect(this.updatingOpcodeStack.current, 'expected updating opcode on the updating opcode stack');
  }

  elements(): ElementBuilder {
    return this.elementStack;
  }

  scope(): Scope {
    return expect(this.scopeStack.current, 'expected scope on the scope stack');
  }

  dynamicScope(): DynamicScope {
    return expect(this.dynamicScopeStack.current, 'expected dynamic scope on the dynamic scope stack');
  }

  pushChildScope() {
    this.scopeStack.push(this.scope().child());
  }

  pushDynamicScope(): DynamicScope {
    let child = this.dynamicScope().child();
    this.dynamicScopeStack.push(child);
    return child;
  }

  pushRootScope(size: number, bindCaller: boolean): Scope {
    let scope = Scope.sized(size);
    if (bindCaller) scope.bindCallerScope(this.scope());
    this.scopeStack.push(scope);
    return scope;
  }

  pushScope(scope: Scope) {
    this.scopeStack.push(scope);
  }

  popScope() {
    this.scopeStack.pop();
  }

  popDynamicScope() {
    this.dynamicScopeStack.pop();
  }

  newDestroyable(d: Destroyable) {
    this.elements().didAddDestroyable(d);
  }

  flushInstructions() {
    const ptr = this.wasmVM.instruction_ptr();
    const instructions = this.wasmVM.instruction_finalize();
    if (instructions === 0)
      return;

    let buf = wasmMemory.buffer.slice(ptr, ptr + instructions * 4);
    this.executor.execute(buf);
  }

  /// SCOPE HELPERS

  getSelf(): PathReference<any> {
    return this.scope().getSelf();
  }

  referenceForSymbol(symbol: number): PathReference<any> {
    return this.scope().getSymbol(symbol);
  }

  /// EXECUTION

  execute(start: number, initialize?: (vm: VM<T>) => void): RenderResult {
    if (DEBUG) {
      console.log(`EXECUTING FROM ${start}`);
    }

    this.wasmVM.set_pc(this.heap.getaddr(start));

    if (initialize) initialize(this);

    return this.executeAll();
  }

  executeAll(): RenderResult {
    try {
      if (this.wasmVM.evaluate_all(this) === 2)
        this.raiseLastVmException();
    } finally {
      this.flushInstructions();
      this.freeWasm();
    }

    return this.lastResult();
  }

  next(): IteratorResult<RenderResult> {
    let result: IteratorResult<RenderResult>;
    let failed = true;
    try {
      const ret = this.wasmVM.evaluate_some(this);
      if (ret === 2)
        this.raiseLastVmException();
      this.flushInstructions();
      if (ret === 0) {
        result = { done: false, value: null };
      } else {
        this.freeWasm();
        result = {
          done: true,
          value: this.lastResult(),
        };
      }
      failed = false;
    } finally {
      if (failed)
        this.freeWasm();
    }
    return result;
  }

  private lastResult(): RenderResult {
    let { env, program, updatingOpcodeStack, elementStack } = this;
    return new RenderResult(
      env,
      program,
      expect(updatingOpcodeStack.pop(), 'there should be a final updating opcode stack'),
      elementStack.popBlock()
    );
  }

  private raiseLastVmException() {
    throw this.wasmVM.last_exception();
  }

  private freeWasm() {
    this.wasmVM.free();
  }

  bindDynamicScope(names: number[]) {
    let scope = this.dynamicScope();

    for(let i=names.length - 1; i>=0; i--) {
      let name = this.constants.getString(names[i]);
      scope.set(name, this.stack.pop<VersionedPathReference<Opaque>>());
    }
  }
}
