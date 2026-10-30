# Two historical RAW source comparators

Delegated repository-tooling classification recognizes only these normalized paths:

- `scripts/ci/runtime-image-only/fixtures/c389-local-source.mjs.fixture.txt`
- `scripts/ci/runtime-image-only/fixtures/c389-operational-forward-cli-v2.mjs.fixture.txt`

They are non-executable copies of the protected c389 source retained for historical catalogue tests. This prerequisite change adds neither file, changes no runtime code and grants no permission to execute their contents. It does not allow other `.txt` files or rename a refused path.

Classification is path-only, not a content, provenance or hash attestation. The consuming historical-source tests must independently bind the actual RAW bytes: SHA256 `e208f43237b89d53158576931e8b4c13acbb0577070c29c39233d1e0fd04237d` and `0f247ca4adb761dcec0ff19f8eea689fe282602464b8904f0380d0a085119ac3`, respectively. This classifier cannot establish those bytes merely from a filename.

Ordinary approval mode remains manual for these paths. Delegated mode still requires the existing protected grant, exact scope/head/checks, a real delegated decision, resolved conversations and normal protected merge. Sensitive reasons remain present. The grant, roles, checks, labels, policy enforcement and deployment authority are unchanged. The candidate classifier must never authorize its own publication: protect this prerequisite separately under the already protected policy before a later fixture-bearing change.
