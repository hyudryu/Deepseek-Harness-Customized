# Browser control

This bundle provides a Playwright Chromium browser per session, the browser tool, and the Web browser controller. Tool calls and panel controls share the same browser context.

## Configuration

Set provider options on the `browser-control` row in the profile patch. `frameQuality` defaults to 60 and accepts integer JPEG quality values from 0 through 100 inclusive; invalid values reject plugin loading.

## Browser lifecycle

Close resolves after the context closes. A cleanup failure rejects the tool or panel request and leaves any still-open context available for another close attempt. Plugin disposal attempts all contexts and then the shared browser even if individual context cleanup fails.

A failed initial navigation rejects the open request and publishes the remaining open context, so the panel can display and stop it.
