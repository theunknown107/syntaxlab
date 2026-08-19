# JSONTestSuite — vendored conformance corpus

The `test_parsing/` corpus from [JSONTestSuite](https://github.com/nst/JSONTestSuite)
by Nicolas Seriot, the published conformance suite for RFC 8259.

| | |
|---|---|
| **Source** | `https://github.com/nst/JSONTestSuite` — `test_parsing/` |
| **Retrieved** | 2026-08-19 |
| **Licence** | MIT — see `LICENSE` in this directory |
| **Files** | 318 (95 `y_`, 188 `n_`, 35 `i_`) |
| **Used by** | `tests/unit/json/conformance.test.ts` |

## Why it is vendored rather than fetched

`docs/21_ACCEPTANCE_CRITERIA.md` J-2 makes this corpus a release gate, and a
gate that depends on a network fetch is not a gate — it is a test that passes
when GitHub is up. Vendoring makes the run reproducible offline and in CI, and
makes the exact bytes under test auditable in the repository.

Its licence is MIT, which `docs/16_DEPENDENCIES.md` §1.3 permits, and the
corpus is named in `docs/04_PARSER_ARCHITECTURE.md` §8 as the intended
conformance reference — so it is the approved corpus rather than arbitrary
third-party material.

## Do not edit these files

Several are deliberately malformed at the byte level — invalid UTF-8, lone
surrogates, truncated sequences. They are stored as bytes and must stay that
way. An editor that "fixes" the encoding on save would silently weaken the
suite. `conformance.test.ts` asserts the file counts for that reason.
