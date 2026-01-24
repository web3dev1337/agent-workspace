const { parseGitHubOwnerRepo, normalizeVisibility } = require('../../server/githubRepoService');

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
});

