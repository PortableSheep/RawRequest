/**
 * Custom Jest transformer that replaces import.meta.url with a mock value.
 * This allows testing code that uses Web Workers without native ESM support.
 */
const { NgJestTransformer } = require('jest-preset-angular/build/ng-jest-transformer');

class ImportMetaTransformer extends NgJestTransformer {
  process(sourceText, sourcePath, options) {
    // Replace import.meta.url with a mock URL before passing to the Angular transformer
    const modifiedSource = sourceText.replace(
      /import\.meta\.url/g,
      "'file:///mock-worker-path/'"
    );
    return super.process(modifiedSource, sourcePath, options);
  }
}

module.exports = {
  createTransformer(options) {
    return new ImportMetaTransformer(options);
  }
};
