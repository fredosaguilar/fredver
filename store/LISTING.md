# Chrome Web Store listing: copy and paste

Upload `store/fredver-store.zip` (build it with `store/build-store-zip.sh`; it strips the `key` field the store does not accept).

## Store listing tab

**Name:** Fredver

**Summary (132 characters max):**
Shared inbox for Columbia Basin Insurance: assign, track, and answer info@ emails as a team, right inside Gmail.

**Description:**
Fredver adds the Columbia Basin Insurance shared inbox to Gmail for our staff.

- See every conversation sent to info@columbiabasininsurance.com in Gmail's sidebar: Unassigned, Mine, Open, Pending, Closed, Sent, and by teammate.
- Assign conversations, set their status, and leave internal notes that clients never see.
- Reply, reply all, or forward from info@ or from your own address, with your Gmail signature and attachments.
- See when a teammate is viewing or replying to the same conversation.
- Open and download attachments with first-page previews.

For Columbia Basin Insurance employees only. Sign-in requires a @columbiabasininsurance.com Google Workspace account that an administrator has added.

**Category:** Workflow & Planning (or Productivity → Communication)
**Language:** English (United States)

**Graphics:**
- Icon: `extension/icons/icon128.png`
- Screenshots (1280×800): `store/screenshot-1-inbox.png`, `store/screenshot-2-conversation.png` (sample data only)
- Small promo tile (440×280): `store/promo-440x280.png`

## Privacy practices tab

**Single purpose:**
Lets Columbia Basin Insurance employees work the company's shared info@ mailbox as a team inside Gmail (view, assign, track status, add internal notes, and reply).

**Permission justifications:**
- `identity`: Signs the employee in with their Google Workspace account (OpenID Connect) so the company backend can verify who they are.
- `storage`: Keeps the employee's sign-in token in session storage (cleared when Chrome closes) and small display preferences.
- Host permission `https://mail.google.com/*`: Adds the shared-inbox section and conversation pane to the Gmail page.
- Host permission `https://cbi-mail-api-1040388630993.us-west1.run.app/*`: The company's own backend, which serves the shared inbox data.

**Remote code:** No, I am not using remote code. (All JavaScript ships in the package; email HTML is displayed in a sandboxed frame with scripts disabled.)

**Data usage: check these boxes:**
- Personally identifiable information (name, email address of the signed-in employee)
- Personal communications (emails in the shared mailbox)
- Authentication information (Google sign-in token)

**Certify all three:**
- I do not sell or transfer user data to third parties, apart from the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** publish `store/PRIVACY.md` on the company website (for example
`https://columbiabasininsurance.com/fredver-privacy`) and paste that link.

## Distribution tab

- **Visibility:** Private
- **Who can install:** "Everyone at columbiabasininsurance.com" (your Workspace domain)
- Regions: all regions (only your domain can see it anyway)

After it's approved, copy the item's **ID** (32 letters, shown in the dashboard), then:
1. Add its sign-in address to the Google Cloud OAuth client "CBI Mail Extension":
   `https://<NEW_ID>.chromiumapp.org/oauth`
2. Admin Console → Devices → Chrome → Apps & extensions → Users & browsers → select the org unit →
   ➕ → "Add Chrome app or extension by ID" → paste the ID → set **Force install**
   (and optionally "Pin to browser toolbar").
3. Everyone removes the old "Load unpacked" copy in `chrome://extensions`.
