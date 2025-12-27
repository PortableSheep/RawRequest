import { Injectable } from '@angular/core';
import {
  SendRequest,
  ExecuteRequests,
  SetVariable,
  GetVariable,
  SaveFileHistoryToRunLocation,
  SaveFileHistoryToDir,
  LoadFileHistoryFromDir,
  LoadFileHistoryFromRunLocation,
  SendRequestWithID,
  SendRequestWithTimeout,
  ExecuteRequestsWithID,
  CancelRequest,
  SaveResponseFile,
  SaveResponseFileToRunLocation,
} from '@wailsjs/go/main/App';

@Injectable({
  providedIn: 'root'
})
export class BackendClientService {
  sendRequest(method: string, url: string, headersJson: string, body: string): Promise<string> {
    return SendRequest(method, url, headersJson, body);
  }

  sendRequestWithID(id: string, method: string, url: string, headersJson: string, body: string): Promise<string> {
    return SendRequestWithID(id, method, url, headersJson, body);
  }

  sendRequestWithTimeout(
    id: string,
    method: string,
    url: string,
    headersJson: string,
    body: string,
    timeoutMs: number
  ): Promise<string> {
    return SendRequestWithTimeout(id, method, url, headersJson, body, timeoutMs);
  }

  executeRequests(requests: Array<Record<string, any>>): Promise<string> {
    return ExecuteRequests(requests);
  }

  executeRequestsWithID(id: string, requests: Array<Record<string, any>>): Promise<string> {
    return ExecuteRequestsWithID(id, requests);
  }

  cancelRequest(requestId: string): Promise<void> {
    return CancelRequest(requestId);
  }

  startLoadTest(
    requestId: string,
    method: string,
    url: string,
    headersJson: string,
    body: string,
    loadConfigJson: string
  ): Promise<void> {
		const g: any = globalThis as any;
		const fn = g?.go?.main?.App?.StartLoadTest;
		if (typeof fn !== 'function') {
			return Promise.reject(new Error('Wails binding missing: StartLoadTest'));
		}
		return fn(requestId, method, url, headersJson, body, loadConfigJson);
  }

  setVariable(key: string, value: string): Promise<void> {
    return SetVariable(key, value);
  }

  getVariable(key: string): Promise<string> {
    return GetVariable(key);
  }

  saveFileHistoryToRunLocation(fileId: string, historyJson: string): Promise<void> {
    return SaveFileHistoryToRunLocation(fileId, historyJson);
  }

  saveFileHistoryToDir(fileId: string, historyJson: string, dir: string): Promise<void> {
    return SaveFileHistoryToDir(fileId, historyJson, dir);
  }

  loadFileHistoryFromDir(fileId: string, dir: string): Promise<string> {
    return LoadFileHistoryFromDir(fileId, dir);
  }

  loadFileHistoryFromRunLocation(fileId: string): Promise<string> {
    return LoadFileHistoryFromRunLocation(fileId);
  }

  saveResponseFile(requestFilePath: string, responseJson: string): Promise<string> {
    return SaveResponseFile(requestFilePath, responseJson);
  }

  saveResponseFileToRunLocation(fileId: string, responseJson: string): Promise<string> {
    return SaveResponseFileToRunLocation(fileId, responseJson);
  }
}
