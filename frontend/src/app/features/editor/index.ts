// Public surface of the editor feature. External code (currently just
// AppComponent) should import EditorComponent from this barrel rather than
// reaching into the feature's internal files (editor.autocomplete,
// editor.lint, editor-search.service, etc.), which are implementation
// details owned by this feature.
export { EditorComponent } from './editor.component';
