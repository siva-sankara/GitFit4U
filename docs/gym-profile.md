# Gym profile editing

Open **Owner workspace → Gym profile**. The new sections save independently:

- **Details:** description, contact information, facilities, amenities and member benefits.
- **Media:** upload JPG, PNG or WebP photos up to 10 MB and MP4 videos up to 50 MB (25 files per gym); select a cover or remove files from the profile. Removal unpublishes the file without deleting its cloud object. Existing URL galleries and videos stay visible.
- **Location:** use device GPS or LocationIQ address search, adjust the entrance marker and confirm the address before saving. Google Maps coordinates remain available as a fallback.
- **Hours:** set each day's hours or mark it closed, using the gym's IANA timezone. A closing time earlier than opening represents overnight hours. Invalid times and duplicate days are rejected.
- **Classes:** create sessions with trainer, category, times, room and capacity; use the timetable for editing and bookings. Class input uses the device timezone. Upcoming scheduled classes appear in public gym details.

## Storage and API

`PATCH /api/v1/owner/gym` accepts `benefits`, `mediaAttachmentIds`, and nullable `coverAttachmentId`, alongside existing `openingHours`, `timezone`, `address` and `location` fields. Media must be completed photo/video uploads belonging to the current gym. A video cannot be the cover. Upload initiation requires gym context and `gym:update` permission.

The browser initiates an upload, sends bytes to the signed S3 PUT URL, then calls the completion endpoint. The backend verifies object size/type before marking it ready. Only then is its attachment ID linked to the gym. Failed uploads cannot publish files; retries after a profile-save failure reuse the completed attachment.

Gym records store attachment IDs, not expiring URLs. Owner and public reads resolve fresh one-hour media links. Lists and nearby search show the selected photo cover. Public gym details display media, amenities, benefits, opening hours and classes under existing visibility rules.

New fields are optional; no migration is needed. Build both applications and restart the backend. Existing profiles and unrelated attendance settings are preserved.

## AWS requirement

The live storage test on 2026-09-09 returned **HTTP 403 AccessDenied for PUT**. Real uploads remain blocked until AWS write access is corrected. No IAM or bucket permissions were changed. See [AWS setup](aws-registration-uploads.md).

The configured region is `ap-south-2`; confirm that the bucket and regional endpoint match. Grant the backend identity `s3:PutObject` and `s3:GetObject` for gym media keys (`<gymId>/<ownerId>/gym_gallery/*`). HEAD verification uses GetObject. The diagnostic also needs Put/Get/Delete under `diagnostics/*`. Keep the bucket private; configure CORS for the exact frontend origins, PUT/GET/HEAD, and Content-Type. Run `npm run test:storage` from backend, then retry the selected file.

## Checks

`npm run test:gym-profile` uses a unique temporary MongoDB database and simulated storage responses, then removes the database. It checks tenant restrictions, metadata validation, photo/video linking, cover selection/removal, location preservation, hours validation, public media/search and classes. Frontend tests cover upload failure/retry, completed-file reuse, hours and entrance confirmation. These checks do not claim successful real AWS uploads.
