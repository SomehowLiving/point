# Extension Validation Harness

Run from the repository root on a machine with Google Chrome and Xvfb:

```bash
xvfb-run -a node extension/tests/validate-real-sites.mjs ./extension ./extension/validation-results.json
```

The harness loads the unpacked Manifest V3 extension, visits every URL in the validation matrix, invokes the service worker capture flow, and records screenshot size, metadata enrichment, duration, and errors.