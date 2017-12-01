import * as rust from '../rust-wrapper';

export type u64 = number;
export type u32 = number;
export type i32 = number;

export class Stack {
  private stack: number;

  constructor() {
    this.stack = rust.stack_new();
    if (this.stack === 0) {
      throw new Error('failed to allocate a new stack in Rust');
    }
  }

  copy(from: u32, to: u32) {
    if (rust.stack_copy(this.stack, from, to) === 0) {
      throw new Error('failed to allocate memory or indexes out of bounds');
    }
  }

  // TODO: how to model u64 argument?
  writeRaw(pos: u32, value: u64): void {
    if (rust.stack_write_raw(this.stack, pos, value) === 0) {
      throw new Error('failed to allocate more memory');
    }
  }

  writeSmi(pos: u32, value: i32): void {
    if (rust.stack_write(this.stack, pos, value) === 0) {
      throw new Error('failed to allocate more memory');
    }
  }

  // TODO: partially decoded enum?
  getRaw(pos: u32): u32 {
    return rust.stack_read_raw(this.stack, pos);
  }

  getSmi(pos: u32): i32 {
    return rust.stack_read(this.stack, pos);
  }

  reset(): void {
    rust.stack_reset(this.stack);
  }

  len(): number {
    return rust.stack_len(this.stack);
  }
}
