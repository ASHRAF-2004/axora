const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

interface FragmentLocation {
  hash: string;
  pathname: string;
}

interface FragmentHistory {
  state: unknown;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

/**
 * Remove the complete fragment before any server action or fetch can run. The
 * clean history entry deliberately drops query values as well as the bearer.
 */
export function readAndClearSecurityTokenFragment(
  location: FragmentLocation,
  history: FragmentHistory,
) {
  const fragment = location.hash.startsWith("#")
    ? location.hash.slice(1)
    : location.hash;
  try {
    history.replaceState(history.state, "", location.pathname);
  } catch {
    return "";
  }
  const parameters = new URLSearchParams(fragment);
  const tokens = parameters.getAll("token");
  return parameters.size === 1 && tokens.length === 1
    && TOKEN_PATTERN.test(tokens[0])
    ? tokens[0]
    : "";
}
