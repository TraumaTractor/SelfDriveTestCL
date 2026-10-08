/** Plain-English explanation for a failed update check, from the error code the desktop shell reports. */
export function updateHint(code: string | undefined): string {
  switch (code) {
    case 'private-or-missing':
      return 'GitHub has no published release to download. Common causes: the release is still a draft or marked "pre-release" (edit it and tick "Set as the latest release"), the build is still attaching files (wait a minute), or the repository is private (then give this computer a read-only token below).';
    case 'denied':
      return 'GitHub rejected the saved token. Create a new read-only token (Contents: read) and use it again.';
    case 'offline':
      return 'Could not reach GitHub. Check your internet connection and try again.';
    case 'no-asset':
      return 'The latest release has no update file (app-update.json). The release build may have failed - check the Actions tab.';
    case 'bad-update':
      return 'The downloaded update did not pass its safety checks, so it was ignored.';
    default:
      return '';
  }
}
