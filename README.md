# Kulvriksh family tree: prototype

This is a simple family tree website with an online admin editor and **no database**. All the data is kept in one file, `data/tree.json`, and the photos are in `data/photos/`.

- **Front end:** Angular 22
- **Back end:** Node.js + Express 5 (TypeScript)
- **Data:** imported from `KUL_VRAKSH 04 Aug 2024.xlsx`. It has 420 people and 190 photos across 6 trees (the whole family plus the 5 branches).

## Run it on your computer

1. Install **Node.js 22 LTS** from https://nodejs.org. This is a one-time step.
2. Open a terminal in this folder, then run:

   ```bash
   npm install      # first time only, takes 1–2 minutes
   npm run dev      # starts the website and the API
   ```

3. Open **http://localhost:4200**. This shows the home page. Click **Family Tree** to open the tree.
4. Click **Admin Login** and enter the prototype password **`Kulvriksh@2026`**.

To stop the site, press `Ctrl + C` in the terminal.

### Your data is safe when you update

All your admin edits are saved in the `data/` folder (`tree.json`, photos, and the last 50 versions in `data/history/`). **Updated zips do not include a `data/` folder.** They ship the original import as `seed-data/`, which is only copied into `data/` the very first time the site starts. So you can extract a new zip over your folder without losing edits. To be extra safe, click **Download backup** in the admin before updating.

**Single-port mode.** You can also run the finished site the way it would run on a server:

```bash
npm start        # builds Angular, then serves everything on http://localhost:3000
```

### Change the admin password

```bash
npm run hash-password
```

Type the new password when asked. The command prints two lines. Paste them into `server/.env` in place of the old `ADMIN_PASSWORD_HASH` and `SESSION_SECRET` lines, then restart the site.

The password itself is never stored. Only its bcrypt hash is kept, in `server/.env`, which never reaches the browser.

## What you can try

**Home page** (http://localhost:4200):
- It shows the family story, the family in numbers, and a card for each branch.
- It has only two actions: **Family Tree**, and **Admin Login**. Logging in takes the admin straight to the tree in edit mode.

**Tree page** (`/tree`, or `/tree/<branch>` for one branch), visitors (no login):
- Use the **trees menu** to switch between Whole family, Durga Shankar, Ramchandra, Raghuvar Dayal, Ramji Das and Bhawani Shankar.
- On each person, use **+ / −** to show or hide their children.
  - The site remembers what you opened, per browser.
- Use **Expand all** or **Collapse all**, and zoom with **− / +**.
  - Drag the background to move around the tree.
- **Search** a name to jump straight to that person.
- Click a person to see their details, spouse, parents and children.
- **Save as picture** downloads the current tree as a PNG.
- **Date of birth and address are hidden from visitors by default.** The server removes them before sending data, so they are not just hidden on the page.

**Admin (after login):**
- **Edit details:** change name, gender, birth and death dates and places, address, notes and life story. You can also set parents and link spouses.
- **Upload photo:** the photo is resized to 800px and saved as JPEG.
  - You can also change or remove it.
- **+ Child / + Spouse / + Parent** add a new relative directly from a person.
- **Delete person:** the confirm step also removes their links to relatives.
- **Show date of birth / Show address:** set these per person. Each one can follow the tree, show, or hide.
- **Manage trees:**
  - add a tree from any top person
  - rename trees and reorder the menu
  - hide a tree from the public
  - turn DOB and address on for a whole tree
- **Unplaced:** lists people from the Excel file whose parent line could not be read. Open each one and set Parent 1 and Parent 2.
- **Download backup:** a ZIP containing `tree.json` and all photos.
- **Safety net:** if two people edit at once, the second save is refused instead of silently overwriting the first. The last 50 versions are kept in `data/history/`.

## About the imported data

The Excel sheets are hand-drawn charts, so `tools/excel_to_json.py` rebuilt the family from three sources:
- the bordered cell boxes (the person cards)
- the pictures above each box
- the connector lines and arrows between them

The full import results are in `data/import-report.txt`. Please spot-check them:
- **28 people** had no readable parent line. They are listed under **Unplaced** in the admin.
- **3 people** had arrows from two different couples. The first couple was kept, and the cases are listed in the report.
- In the Excel, the date coloured **red** is read as the death date, and the boxed row is the marriage date.
- Some cards hold notes instead of dates. Those notes went into the person's Notes field.

To re-run the import (this replaces `data/`, so make a backup first):

```bash
pip install openpyxl pillow
python tools/excel_to_json.py "KUL_VRAKSH 04 Aug 2024.xlsx" data
```

## Tests

```bash
npm test
```

There are 8 API tests. They check that:
- hidden DOB and address never reach visitors
- the person-level setting overrides the tree-level setting
- a wrong password and saves without logging in are refused
- a stale save is refused
- bad dates and family loops are rejected
- uploaded photos are re-encoded, and non-images are refused
- tree add, edit and hide work
- logging out ends the session

## Folder layout

```
client/   Angular app (src/app: tree-view, tree-node, person-panel, trees-manager, api.service)
server/   Express API (src/app.ts routes, model.ts edits + validation, privacy.ts, storage/local.ts)
data/     tree.json, photos/, import-report.txt   ← the whole "database"
tools/    excel_to_json.py (one-time Excel import)
```

Storage sits behind a small interface (`server/src/storage/storage.ts`). Moving to Google Cloud Storage or Cloudflare R2 later means adding one file next to `local.ts`. The rest of the code stays the same.

## Not in the prototype yet

- Hosting and a public address. The name and hosting decision is still open.
- Cloud storage (GCS or R2).
- Hindi names.
- Photo cropping in the browser. Photos are currently resized automatically.
- An undo history in the UI. Old versions are in `data/history/`.
- Excel import and export from the admin screen.
