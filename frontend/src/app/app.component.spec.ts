import { render } from '@testing-library/angular';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  it('should render', async () => {
    const { fixture } = await render(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
