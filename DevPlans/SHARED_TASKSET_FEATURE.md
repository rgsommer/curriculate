# Substitute Teacher Taskset Sharing Feature

## Overview
This feature allows teachers to share task sets with substitute teachers by generating time-limited shareable links. Substitute teachers can use these links to run the task set without requiring a login, and the results are automatically emailed back to the original teacher.

## Implementation Summary

### 1. Backend: Create Share Link Endpoint
**File**: `/backend/routes/shared.js` and `/backend/controllers/sharedController.js`

- **Endpoint**: `POST /api/shared/create-link`
- **Authentication**: Required (JWT middleware via `authAny`)
- **Request Body**: `{ tasksetId: "<taskSetId>" }`
- **Response**:
  ```json
  {
    "ok": true,
    "token": "32-char-hex-token",
    "link": "https://app.curriculate.net/shared/token",
    "expiresAt": "2026-04-12T..."
  }
  ```

**Features**:
- Validates taskset exists and belongs to authenticated user
- Generates cryptographically secure token (16 bytes)
- Hashes token with SHA256 (stored in MongoDB)
- Creates 7-day expiring link
- Captures teacher name and email for report attribution

### 2. Backend: Launch Shared Taskset
**File**: `/backend/controllers/sharedController.js`

- **Endpoint**: `POST /api/shared/:token/launch` (PUBLIC)
- **Response**: Guest JWT + Room Code + Taskset Metadata
- **Features**:
  - Validates token exists and not expired/revoked
  - Creates fresh room code on each call (new session on page refresh)
  - Mints guest JWT with shared teacher attribution claims
  - No login required
  - Includes teacher name and email in JWT for email routing

### 3. Frontend: Share Button in TaskSetEditor
**File**: `/teacher-app/src/pages/TaskSetEditor.jsx`

- **UI**: "Share with Substitute" button (visible only for saved tasksets)
- **Modal**: Displays shareable link with:
  - Copyable link (full URL)
  - Expiration date (7 days)
  - Copy button with visual feedback
  - Close button

**State Management**:
- `shareModalOpen`: Controls modal visibility
- `shareLoading`: Shows loading state during API call
- `shareLink`: Stores the generated link
- `shareExpiresAt`: Stores expiration date for display

### 4. Frontend: Shared Launch Page
**File**: `/teacher-app/src/pages/SharedLaunch.jsx`

- **Route**: `/shared/:token`
- **Behavior**:
  - Calls `POST /api/shared/:token/launch` on mount
  - Stores guest JWT in localStorage
  - Stores taskset metadata for LiveSession
  - Stores shared teacher attribution in localStorage
  - Redirects to `/live` to enter the session
  - On refresh: Gets new room code, same taskset, same attribution

**LocalStorage Keys**:
- `token`: Guest JWT
- `curriculateRoomCodeOverride`: Room code for this session
- `curriculateActiveTasksetId`: Which taskset to run
- `curriculateActiveTasksetMeta`: Taskset details
- `curriculateSharedFromTeacherId`: Original teacher ID
- `curriculateSharedFromTeacherEmail`: Original teacher email
- `curriculateLaunchImmediately`: Signal to auto-launch

### 5. Backend: Room Attribution
**File**: `/backend/index.js` - `teacher:createRoom` handler

When LiveSession creates/joins a room:
- Accepts `sharedFromTeacherId` and `sharedFromTeacherEmail` from client
- Stores these on the room object as `room.reportOwnerId` and `room.reportOwnerEmail`
- Ensures they are included in SessionReport document

### 6. Email Results to Original Teacher
**File**: `/backend/index.js` - `teacher:endSessionAndEmail` handler

When session ends and report is generated:
1. Creates SessionReport with:
   - `sharedFromTeacherId`: Who shared the task set
   - `sharedFromTeacherEmail`: Email to send report to
   - `runByPresenterId`: Who actually ran it (substitute or guest)
   - `runByPresenterEmail`: Substitute's email (if available)

2. Sends report email to both:
   - Original teacher (at `sharedFromTeacherEmail`)
   - Substitute/presenter (at their provided email)

3. Optional flag `isSharedRunCopy` can customize email wording for the original teacher

## Data Flow

```
[Teacher A] -> "Share with Substitute" button
                     ↓
            [POST /api/shared/create-link]
                     ↓
            Create SharedTasksetLink document
                     ↓
            Generate shareable link + token
                     ↓
[Copy link, send to Substitute B]
                     ↓
[Substitute B] -> Click link
                     ↓
            [SharedLaunch page at /shared/:token]
                     ↓
            [POST /api/shared/:token/launch]
                     ↓
            Validate token, mint guest JWT
                     ↓
            Create fresh room, store attribution
                     ↓
            Redirect to /live (LiveSession)
                     ↓
[Substitute runs taskset]
                     ↓
[End session, generate report]
                     ↓
            [teacher:endSessionAndEmail]
                     ↓
            Create SessionReport with attribution
                     ↓
[Email report to both Teacher A and Substitute B]
```

## Security Considerations

1. **Token Security**:
   - 16-byte (128-bit) random token
   - Stored as SHA256 hash in database
   - Compared via timing-safe hash in launch endpoint
   - 7-day expiration with auto-delete via MongoDB TTL index

2. **Access Control**:
   - Create link requires authentication
   - Verified that teacher owns the taskset
   - Guest tokens cannot perform authenticated actions
   - Launch endpoint public but requires valid, non-expired token

3. **Attribution**:
   - Original teacher email encrypted/hashed in SessionReport
   - Reports clearly show who shared and who ran
   - Email headers include proper attribution

## Testing Checklist

- [ ] Teacher can click "Share with Substitute" button
- [ ] Modal displays with clickable, copyable link
- [ ] Link format is correct: `/shared/{token}`
- [ ] Link works when visited by unauthenticated user
- [ ] Substitute reaches LiveSession without login
- [ ] Page refresh creates new room but keeps same taskset
- [ ] Taskset runs normally for substitute
- [ ] Session report created with correct attribution
- [ ] Original teacher receives email with report
- [ ] Link expires after 7 days (returns 410 Gone)
- [ ] Revoked links return 410 Gone
- [ ] Invalid tokens return 404

## Environment Variables

- `TEACHER_APP_URL`: Frontend URL for generating shareable links (default: `https://app.curriculate.net`)
- `JWT_SECRET`: For minting guest tokens (already in use)

## Related Models

- **SharedTasksetLink**: Stores token hash, taskset, owner, expiration
- **SessionReport**: Includes shared attribution fields
- **TaskSet**: The content being shared
- **User**: Teacher who created the link

## API Reference

### Create Share Link
```
POST /api/shared/create-link
Authorization: Bearer {teacher-jwt}
Content-Type: application/json

{
  "tasksetId": "507f1f77bcf86cd799439011"
}

Response 200:
{
  "ok": true,
  "token": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "link": "https://app.curriculate.net/shared/a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "expiresAt": "2026-04-12T10:30:00Z"
}
```

### Launch Shared Taskset
```
POST /api/shared/:token/launch
Content-Type: application/json

{}

Response 200:
{
  "ok": true,
  "roomCode": "AB",
  "presenterJwt": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": "2026-04-12T10:30:00Z",
  "authorDisplay": "Richard",
  "sharedFromTeacherId": "teacher-user-id",
  "sharedFromTeacherEmail": "teacher@example.com",
  "tasksetMeta": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Biology 101: Photosynthesis",
    "subject": "Biology",
    "gradeLevel": "9",
    "numTasks": 8
  }
}
```

## Future Enhancements

1. **Email Notifications**: Send email to original teacher when shared link is created
2. **Usage Tracking**: Track which substitutes have used which links
3. **Bulk Sharing**: Share with multiple substitutes at once
4. **Custom Messages**: Teachers can add notes when sharing
5. **Results Snapshots**: Automated digest of results from shared runs
6. **Link Management**: UI to view, revoke, or extend shared links
