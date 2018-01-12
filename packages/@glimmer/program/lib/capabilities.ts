import { ComponentCapabilities } from "@glimmer/interfaces";

const DYNAMIC_LAYOUT = 0b000001;
const DYNAMIC_TAG    = 0b000010;
const PREPARE_ARGS   = 0b000100;
const CREATE_ARGS    = 0b001000;
const ATTRIBUTE_HOOK = 0b010000;
const ELEMENT_HOOK   = 0b100000;

export class ComponentCapabilitiesMask implements ComponentCapabilities {
  private mask = 0;

  constructor(input: ComponentCapabilities | number) {
    if (typeof(input) === 'number') {
      this.mask = input;
    } else {
      this.mask =
        (input.dynamicLayout ? DYNAMIC_LAYOUT : 0) |
        (input.dynamicTag ? DYNAMIC_TAG : 0) |
        (input.prepareArgs ? PREPARE_ARGS: 0) |
        (input.createArgs ? CREATE_ARGS: 0) |
        (input.attributeHook ? ATTRIBUTE_HOOK : 0) |
        (input.elementHook ? ELEMENT_HOOK : 0);
    }
  }

  get dynamicLayout(): boolean {
    return (this.mask & DYNAMIC_LAYOUT) !== 0;
  }

  get dynamicTag(): boolean {
    return (this.mask & DYNAMIC_TAG) !== 0;
  }

  get prepareArgs(): boolean {
    return (this.mask & PREPARE_ARGS) !== 0;
  }

  get createArgs(): boolean {
    return (this.mask & CREATE_ARGS) !== 0;
  }

  get attributeHook(): boolean {
    return (this.mask & ATTRIBUTE_HOOK) !== 0;
  }

  get elementHook(): boolean {
    return (this.mask & ELEMENT_HOOK) !== 0;
  }

  getMask(): number {
    return this.mask;
  }
}
