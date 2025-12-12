import { provideZoneChangeDetection } from "@angular/core";
import 'zone.js';  // Included with Angular CLI.

import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';


bootstrapApplication(AppComponent, {providers: [provideZoneChangeDetection()]})
  .catch(err => console.error(err));
