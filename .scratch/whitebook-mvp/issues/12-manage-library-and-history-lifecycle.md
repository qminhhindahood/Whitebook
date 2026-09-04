# 12 — Manage Library and History lifecycle

**What to build:** A clear Library, Import, and History experience for finding sources and Attempts, resuming unfinished work, archiving packages safely, and confirming every destructive removal.

**Blocked by:** 04 — Publish an immutable Test Package; 06 — Pause, recover, and resume Attempts; 11 — Review Results and practise mistakes.

**Status:** ready-for-agent

- [ ] Main navigation exposes Library, Import, and History with Paused Attempts shown prominently.
- [ ] Library distinguishes active and archived Test Packages and shows revision, source filename, counts, and eligibility.
- [ ] Normal removal archives a Test Package that has Attempt history instead of destroying it.
- [ ] Archived Test Packages remain usable for existing Results and can be restored to Library.
- [ ] Permanent Test Package deletion requires confirmation that its Attempts, Results, Source PDF, and derived cache will also be removed.
- [ ] Unfinished Attempts can be deleted only from History through explicit confirmation.
- [ ] Removal actions cannot target another Test Package or files outside Whitebook's data store.
- [ ] Lifecycle changes persist across restart and never mutate immutable completed Results.
- [ ] Integration and browser tests cover navigation, resume prominence, archive/restore, deletion confirmation, and deletion scope.
