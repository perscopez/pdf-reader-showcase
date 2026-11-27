// Fixes a var hoisting collision: pdf.mjs contains `var __webpack_exports__ = {}` which,
// inside webpack eval() wrappers, gets hoisted to the top of the eval scope and shadows
// the outer webpack's __webpack_exports__ closure variable (making it undefined).
// Renaming it to a private identifier prevents the shadow and the resulting TypeError.
module.exports = function pdfjsExportsFix(source) {
  return source.replace('var __webpack_exports__ = {};', 'var _pdfjs_inner_exports_ = {};')
}
