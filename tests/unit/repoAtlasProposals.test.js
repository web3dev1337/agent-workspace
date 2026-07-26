const fs = require('fs');
const os = require('os');
const path = require('path');

const RepoAtlasService = require('../../server/repoAtlasService');

describe('Atlas write-back', () => {
  let tmpDir;
  let atlas;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-proposals-'));
    process.env.AGENT_WORKSPACE_ATLAS_DIR = tmpDir;
    atlas = new RepoAtlasService();
  });

  afterEach(() => {
    delete process.env.AGENT_WORKSPACE_ATLAS_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('a proposal does not touch the map until it is approved', () => {
    atlas.proposeHighlight({ repoId: 'zoo-game', topic: 'testing', quality: 5, proposedBy: 'work1-claude' });

    expect(atlas.find('testing')).toEqual([]);
    expect(atlas.listProposals()).toHaveLength(1);
  });

  test('approving writes through the same path manual curation uses', () => {
    atlas.proposeHighlight({ repoId: 'zoo-game', topic: 'testing', quality: 5, notes: 'good harness' });
    const result = atlas.approveProposal('zoo-game:testing');

    expect(result.ok).toBe(true);
    const hits = atlas.find('testing');
    expect(hits).toHaveLength(1);
    expect(hits[0].quality).toBe(5);
    expect(hits[0].notes).toBe('good harness');
  });

  test('rejecting leaves the map untouched and clears the queue', () => {
    atlas.proposeHighlight({ repoId: 'zoo-game', topic: 'testing', quality: 5 });
    expect(atlas.rejectProposal('zoo-game:testing').ok).toBe(true);

    expect(atlas.find('testing')).toEqual([]);
    expect(atlas.listProposals()).toEqual([]);
    expect(atlas.listProposals({ status: 'rejected' })).toHaveLength(1);
  });

  test('a second proposal for the same topic supersedes the first rather than stacking', () => {
    atlas.proposeHighlight({ repoId: 'zoo-game', topic: 'testing', quality: 3 });
    atlas.proposeHighlight({ repoId: 'zoo-game', topic: 'testing', quality: 5 });

    const pending = atlas.listProposals();
    expect(pending).toHaveLength(1);
    expect(pending[0].quality).toBe(5);
    expect(pending[0].supersedes).toBeTruthy();
  });

  test('topic aliases are normalized so proposals do not fragment the vocabulary', () => {
    atlas.proposeHighlight({ repoId: 'zoo-game', topic: 'unit-tests', quality: 4 });
    expect(atlas.listProposals()[0].topic).toBe('testing');
  });

  test('an avoid proposal records a do-not-copy note when approved', () => {
    atlas.proposeHighlight({ repoId: 'zoo-game', topic: 'ui', kind: 'avoid', notes: 'hand-rolled, superseded' });
    atlas.approveProposal('zoo-game:ui');

    expect(atlas.getEntry('zoo-game').avoid).toEqual([{ topic: 'ui', reason: 'hand-rolled, superseded' }]);
  });

  test('quality is clamped, so an over-eager agent cannot invent a 9/5', () => {
    atlas.proposeHighlight({ repoId: 'zoo-game', topic: 'testing', quality: 9 });
    expect(atlas.listProposals()[0].quality).toBe(5);
  });

  test('proposals without a repo or topic are refused', () => {
    expect(() => atlas.proposeHighlight({ topic: 'testing' })).toThrow(/repo id/);
    expect(() => atlas.proposeHighlight({ repoId: 'zoo-game' })).toThrow(/topic/);
  });

  test('deciding an unknown proposal reports it instead of failing silently', () => {
    expect(atlas.approveProposal('nope:testing').ok).toBe(false);
    expect(atlas.rejectProposal('nope:testing').ok).toBe(false);
  });

  test('evidence travels with the proposal so review takes seconds', () => {
    atlas.proposeHighlight({
      repoId: 'zoo-game',
      topic: 'testing',
      quality: 4,
      evidence: 'added 40 tests in tests/unit, all green',
      proposedBy: 'work1-claude'
    });

    const [proposal] = atlas.listProposals();
    expect(proposal.evidence).toBe('added 40 tests in tests/unit, all green');
    expect(proposal.proposedBy).toBe('work1-claude');
  });

  test('clearing decided proposals keeps the pending ones', () => {
    atlas.proposeHighlight({ repoId: 'a', topic: 'testing', quality: 4 });
    atlas.proposeHighlight({ repoId: 'b', topic: 'physics', quality: 4 });
    atlas.rejectProposal('a:testing');

    expect(atlas.clearDecidedProposals()).toBe(1);
    expect(atlas.listProposals({ status: 'all' })).toHaveLength(1);
  });

  test('proposal stats surface in atlas status', () => {
    atlas.proposeHighlight({ repoId: 'zoo-game', topic: 'testing', quality: 4 });
    expect(atlas.getStatus().proposals.pending).toBe(1);
  });
});
