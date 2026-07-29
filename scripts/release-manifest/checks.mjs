export function parseRequiredChecks(value) {
  const checks = [
    ...new Set(
      String(value ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
  if (checks.length === 0) {
    throw new Error("REQUIRED_RELEASE_CHECKS must contain an explicit list.");
  }
  return checks;
}

function latestRunsByName(checkRuns) {
  const byName = new Map();
  for (const run of checkRuns) {
    const previous = byName.get(run.name);
    const previousOrder = Number(previous?.id ?? 0);
    const currentOrder = Number(run.id ?? 0);
    if (!previous || currentOrder >= previousOrder) {
      byName.set(run.name, run);
    }
  }
  return byName;
}

export function validateRequiredChecks(requiredChecks, checkRuns) {
  if (!Array.isArray(requiredChecks) || requiredChecks.length === 0) {
    throw new Error("Required release check list is empty.");
  }

  const byName = latestRunsByName(checkRuns);
  const missing = [];
  const incomplete = [];
  const unsuccessful = [];

  for (const name of requiredChecks) {
    const run = byName.get(name);
    if (!run) {
      missing.push(name);
    } else if (run.status !== "completed") {
      incomplete.push(name);
    } else if (run.conclusion !== "success") {
      unsuccessful.push(name);
    }
  }

  if (missing.length || incomplete.length || unsuccessful.length) {
    const error = new Error("Required release checks are not satisfied.");
    error.details = { missing, incomplete, unsuccessful };
    throw error;
  }

  return {
    required: requiredChecks,
    successful: requiredChecks.length,
    additionalChecks: checkRuns.filter(
      (run) => !requiredChecks.includes(run.name),
    ).length,
  };
}

export async function fetchAllCheckRuns({
  repository,
  commitSha,
  token,
  fetchImpl = globalThis.fetch,
}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("Invalid GitHub repository.");
  }
  if (!/^[0-9a-f]{40}$/i.test(commitSha)) {
    throw new Error("Invalid release commit SHA.");
  }
  if (!token) {
    throw new Error("GitHub token is required to read check runs.");
  }

  const allRuns = [];
  let page = 1;
  let totalCount = null;

  while (page <= 1000) {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repository}/commits/${commitSha}/check-runs?per_page=100&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub check-runs request failed (${response.status}).`);
    }

    const body = await response.json();
    if (!Array.isArray(body.check_runs) || !Number.isInteger(body.total_count)) {
      throw new Error("Invalid GitHub check-runs response.");
    }
    totalCount ??= body.total_count;
    if (body.total_count !== totalCount) {
      throw new Error("GitHub check-runs pagination changed during retrieval.");
    }
    allRuns.push(...body.check_runs);

    if (allRuns.length >= totalCount) {
      return allRuns.slice(0, totalCount);
    }
    if (body.check_runs.length !== 100) {
      throw new Error("GitHub check-runs pagination is incomplete.");
    }
    page += 1;
  }

  throw new Error("GitHub check-runs pagination limit exceeded.");
}
