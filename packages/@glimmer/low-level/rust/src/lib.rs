// This unstable feature is currently used for the `wasm_bindgen` macro which
// allows us to define Rust code and have TypeScript automatically generated
// for consumption elsewhere.
#![feature(proc_macro)]

extern crate wasm_bindgen;

use wasm_bindgen::prelude::*;

#[macro_use]
mod debug;
#[macro_use]
mod util;

mod track;
mod my_ref_cell;
mod gbox;
mod component;

pub mod stack;
pub mod vm;
pub mod opcode;
pub mod ffi;
pub mod heap;
pub mod instructions;

#[no_mangle]
#[wasm_bindgen]
pub extern fn num_allocated() -> usize {
    track::total()
}

fn to_u32(a: i32) -> u32 {
    debug_assert!(a >= 0);
    a as u32
}
