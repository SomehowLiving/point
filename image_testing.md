# Image Integration Testing Rules

The testing agent must follow these rules exactly when validating image integrations.

- Always use base64-encoded images for tests and requests.
- Accepted formats: JPEG, PNG, and WEBP only.
- Do not use SVG, BMP, HEIC, or other formats.
- Do not upload blank, solid-color, or uniform-variance images.
- Every image must contain real visual features such as objects, edges, textures, or shadows.
- If an image is not PNG/JPEG/WEBP, transcode it to PNG or JPEG before upload.
- Re-detect the MIME type after transformations and ensure it matches the actual bytes.
- For animated images (GIF, APNG, animated WEBP), extract the first frame only.
- Resize large images to reasonable bounds to avoid oversized payloads.
