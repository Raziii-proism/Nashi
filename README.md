# SpatialSync Coordinate Reader

A browser-based trial for calibrating a physical coordinate mat and reading points from a camera or image.

## Open in Antigravity

1. Extract this ZIP file.
2. In Antigravity, open the extracted `Antigravity_SpatialSync` folder as the project.
3. In its terminal, run `npm start` and open the displayed `http://localhost:8080` preview.
4. Use **Load demo** first, or start the camera / upload a mat photo. Camera access needs localhost or HTTPS and browser permission.

Suggested Antigravity prompt:

> Review this project's README, start the app with `npm start`, and preview it in the browser. Keep the existing coordinate-reading behavior. Before deploying, ask which hosting project and audience I want to use.

## Deploy to Firebase Hosting

The included `firebase.json` is already configured to publish the `public/` folder. From the project root, authenticate with the Firebase CLI, select the intended Firebase project, then run:

```sh
firebase deploy --only hosting
```

This produces an HTTPS site, which supports browser camera access after the visitor grants permission.

## Deploy to Vercel

The included `vercel.json` sets `public/` as the static output directory. From the project root, use the Vercel CLI and select/link the intended Vercel project:

```sh
vercel
vercel --prod
```

The first command links and deploys the project; use `vercel --prod` for a production deployment.

## Container deployment

The included `Dockerfile` and `server.mjs` serve the same static files on the `PORT` provided by the hosting platform (8080 by default). The server uses only built-in Node.js modules; the app has no npm dependencies.

## Coordinate workflow

- Enter the mat's width (X) and depth (Z) in centimeters.
- Select **Calibrate mat**, then tap these corners in order: far-left, far-right, near-right, near-left.
- Tap a point on the mat, or use **Detect red target** to find the largest bright-red region.
- Y is set to 0 cm on the mat surface. Readings can be saved locally and exported as CSV.

The four-point calibration corrects perspective for a flat mat. Target detection looks for a bright-red mark; mat-corner detection and multi-phone synchronization are not included in this trial. Images are processed in the browser and are not uploaded by the app.
