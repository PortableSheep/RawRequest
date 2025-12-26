import { LRLanguage, LanguageSupport } from '@codemirror/language';

import { parser as rawRequestHttpParser } from './rawrequest-http-parser';

const rawRequestHttpLanguage = LRLanguage.define({ parser: rawRequestHttpParser });

export const rawRequestHttpSupport = new LanguageSupport(rawRequestHttpLanguage);
