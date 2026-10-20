# Engineering Instructions

This repository implements the biz-project skill. Keep the skill portable:
do not embed personal paths, live project records or project-specific branch
names in executable defaults. Project-specific agreements belong in external
project profiles and the projects' own guidance.

Read docs/design.md before changing initialization, discovery or data contracts.
Read references/record-format.md before changing stored schemas. Change related
skill instructions, references and README in the same task as behavior changes.

Use Node.js built-ins only. Run `npm test` and `npm run check` after script changes.
Test filesystem writes only in controlled temporary directories. Protect existing
guidance and central records; retries must not erase prior data.

Use biz-project for new storage/configuration names. Never create a records center
from a fallback path. Missing centers require the user's confirmed path, passed
explicitly as --records-root; legacy centers are reported, not implicitly reused.

Do not initialize user projects, install globally, migrate notes, commit, push
or publish merely to test the skill. Delegation needs explicit approval for the
specific call and an available Luna-series model. Otherwise work in this session.

Before publishing, keep generated records, user pointer files, credentials,
private paths and fixture output out of the source repository. The user chooses
the license and distribution destination.

For versioned releases, follow docs/versioning.md. Keep package.json,
package-lock.json, CHANGELOG.md and docs/releases/v<version>.md consistent and run
`npm run version:check` before committing. Create or push commits/tags only when
authorized; published version tags are immutable.
