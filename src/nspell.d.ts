// Ambient types for `nspell` (the package ships no .d.ts and there is no
// @types/nspell). Declares exactly the surface this app uses — construction from
// an affix + dictionary document, the boolean spelling verdict, and adding a
// custom word — so the spellchecker is consumed with real types, never `any`.
declare module "nspell" {
  /** A hunspell-backed spell checker over an affix + dictionary document. */
  interface NSpell {
    /** True iff `word` is spelled correctly (in the base dictionary or added). */
    correct(word: string): boolean;
    /** Add `word` to the checker's accepted vocabulary. */
    add(word: string): NSpell;
  }
  /** Construct a checker from an affix document and a dictionary document. */
  function nspell(aff: string, dic: string): NSpell;
  export default nspell;
}
