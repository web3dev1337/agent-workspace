const {
  parseGitHubOwnerRepo,
  normalizeVisibility,
  parseGitHubAuthOutput,
  parseGitHubHostsFile
} = require('../../server/githubRepoService');

describe('GitHubRepoService helpers', () => {
  describe('parseGitHubOwnerRepo', () => {
    it('parses https remotes', () => {
      expect(parseGitHubOwnerRepo('https://github.com/foo/bar.git')).toEqual({ owner: 'foo', repo: 'bar' });
      expect(parseGitHubOwnerRepo('https://github.com/foo/bar')).toEqual({ owner: 'foo', repo: 'bar' });
    });

    it('parses ssh remotes', () => {
      expect(parseGitHubOwnerRepo('git@github.com:foo/bar.git')).toEqual({ owner: 'foo', repo: 'bar' });
      expect(parseGitHubOwnerRepo('ssh://git@github.com/foo/bar.git')).toEqual({ owner: 'foo', repo: 'bar' });
    });

    it('returns null for non-github remotes', () => {
      expect(parseGitHubOwnerRepo('https://gitlab.com/foo/bar.git')).toBeNull();
      expect(parseGitHubOwnerRepo('')).toBeNull();
      expect(parseGitHubOwnerRepo(null)).toBeNull();
    });
  });

  describe('normalizeVisibility', () => {
    it('normalizes public/private', () => {
      expect(normalizeVisibility('PUBLIC')).toBe('public');
      expect(normalizeVisibility('private')).toBe('private');
    });

    it('maps internal to team', () => {
      expect(normalizeVisibility('INTERNAL')).toBe('team');
    });

    it('returns null for unknown values', () => {
      expect(normalizeVisibility('something')).toBeNull();
      expect(normalizeVisibility('')).toBeNull();
    });
  });

  describe('parseGitHubAuthOutput', () => {
    it('parses authenticated output even when gh writes it to stderr', () => {
      expect(parseGitHubAuthOutput('', `
github.com
  ✓ Logged in to github.com account octocat (/tmp/hosts.yml)
  - Active account: true
      `)).toEqual(expect.objectContaining({
        authenticated: true,
        user: 'octocat'
      }));
    });

    it('parses not-authenticated output', () => {
      expect(parseGitHubAuthOutput('', 'You are not logged into any GitHub hosts. To log in, run: gh auth login'))
        .toEqual(expect.objectContaining({
          authenticated: false,
          user: null
        }));
    });
  });

  describe('parseGitHubHostsFile', () => {
    it('extracts stored auth hints from github.com block', () => {
      expect(parseGitHubHostsFile(`
github.com:
    user: octocat
    oauth_token: gho_test
    git_protocol: https
`)).toEqual({
        hasStoredAuth: true,
        user: 'octocat'
      });
    });

    it('returns null when github.com block is missing', () => {
      expect(parseGitHubHostsFile(`
example.com:
    user: someone
    oauth_token: token
`)).toBeNull();
    });
  });
});
