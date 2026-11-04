# Foodfolio AI workflows

The public app and Prompt Chain Lab use the same database chains and enabled model registry.

| Module | Default stages | Final output |
| --- | --- | --- |
| Food reactions | Observe photo → plan character/reaction → draft reaction → polish/check | Caption |
| Daily Meal Coach | Observe uploaded meals → map goals/restrictions → draft next meals → check/format | Meal plan |
| Group Ordering | Map every diner → inspect supplied menu evidence → draft individual/sharing ideas → verify/format | Ordering plan |

Chains support one to six editable, ordered steps. The last step always produces the module's validated output. Intermediate stages produce working notes. The first step receives photos; later steps receive the original text context and previous output. A database snapshot fixes the chain version for the full request.

Food-reaction variants retain Studio's existing weighted character mix. Meal Coach and Group Ordering each have one active route, selected with **Use this chain in the app** in the Lab. New chains remain drafts until selected. Editing an active chain applies to new requests. Module identity cannot be changed after creation; create a new chain instead.

Public meal profiles, diner opinions, photos and generated plans are request-only. They are not inserted into the caption logs or saved as posts. Lab previews require explicit consent to send test input to Gemini and save the generated result and step outputs. Use fictional profiles, anonymous diners and food-only photos. Raw photos are not persisted.

## Validation

- Public app: `node --test tests/week4.mjs tests/week7.mjs tests/workflows.mjs`
- Lab: `npm run check`, `npm test`, `npm run build`
- `tests/modules-database.sql`: transactional checks of CRUD, ordering, revisions, route activation, archive protection and ordinary/admin/anonymous access; all test changes roll back.
- The `lib/ai/{workflow,meal-coach,group-order}.ts` implementations and domain validators in the public and Lab repositories are kept identical. Do not update one without updating the other.

For a real provider smoke test, sign in as a superadmin, select each module and run it with test input. Verify four real outputs and the final result. Repeat through the public application's Meal Coach and ordering UI. Automated tests inject provider responses; they do not establish live Gemini availability.
