# Foodfolio Prompt Chain Lab

Week 8 is a standalone Next.js app. It shares the Foodfolio Supabase project, Google sign-in, superadmin role, and Gemini model registry. The Lab edits the same caption chains and ordered steps that Kitchen uses and Studio monitors. Run previews are stored separately from Kitchen captions and do not create posts.

## Setup

1. Apply `supabase/week8_foodfolio.sql` after the Week 6 and Week 7 migrations. Existing Lab demo records are retained in their legacy tables.
2. Set the three variables listed in `.env.example`. Keep the Gemini key server-side.
3. Add the local, stable deployment, and commit-specific deployment `/auth/callback` URLs to the existing Supabase Auth redirect allowlist.
4. Run `npm ci`, `npm test`, and `npm run build`. Use Node 24.
5. For local development, run `npm run dev` and visit http://localhost:3008.

## Demonstration

- In a signed-out browser, open the app and see its Google sign-in screen. An ordinary account is denied. A user with `profiles.is_superadmin = true` can open the workspace.
- Create a chain, edit its name or description, and add two steps. Edit the instruction for one step, move it to position 1, and verify the order survives a reload.
- Run an existing Foodfolio persona chain with a dish name and a JPEG, PNG or WebP. Open **Generated media** to see the captions and expand the trace to inspect each intermediate result.
- Switch among Light, Dark and System default. Reload to verify that the preference persists.
- Delete a disposable step and chain using their typed confirmations. Removing a chain archives it, keeping prior generation records. Enable a new chain in the Studio mix to make it available to Kitchen.

## Deployment

Use the dedicated Week 8 GitHub repository and Vercel project. Configure the same Foodfolio Supabase URL and publishable key and the existing Gemini provider key. Disable Vercel Deployment Protection so a fresh browser reaches the application's own Google login gate. Submit the latest commit-specific deployment URL for the public app, the admin app and this tool.
