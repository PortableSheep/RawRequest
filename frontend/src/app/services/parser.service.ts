import { Injectable } from '@angular/core';
import { Request } from '../models/http.models';
import { parseHttpFile as parseHttpFileHelper } from './parser/parse-http-file';

export interface ParsedHttpFile {
  requests: Request[];
  environments: { [env: string]: { [key: string]: string } };
  variables: { [key: string]: string };
  groups: string[];
  fileDisplayName?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ParserService {
  parseHttpFile(content: string): ParsedHttpFile {
    return parseHttpFileHelper(content);
  }
}