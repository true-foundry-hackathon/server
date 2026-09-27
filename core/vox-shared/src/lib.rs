/*!
* Small, genuinely-duplicated types and constants shared across the Vox
* Rust codebases (vox-core, vox-desktop, and vox-bridge if it ever needs
* one), so they have one home instead of drifting copies. Add a module
* here only for something that's *already* duplicated verbatim in two
* places -- not speculatively.
*/
pub mod sms;
