import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useParams, useLocation } from 'react-router-dom';
import DiffViewer from './components/DiffViewer';
import SmartDiffViewer from './components/SmartDiffViewer';
import ErrorBoundary from './components/ErrorBoundary';
import LoadingSpinner from './components/LoadingSpinner';
import axios from 'axios';
import './styles/App.css';
import { ThemeProvider } from './context/theme';

// Configure axios defaults
axios.defaults.baseURL = '/api';

function DiffViewerRoute() {
  const { owner, repo, pr, sha } = useParams();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search || '');
  const initialFilePath = String(searchParams.get('file') || '').trim();
  const [diffData, setDiffData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchDiffData();
  }, [owner, repo, pr, sha]);

  const fetchDiffData = async () => {
    try {
      setLoading(true);
      setError(null);

      const isPr = Boolean(pr);
      const id = isPr ? pr : sha;
      if (!id) {
        throw new Error('Missing PR number or commit SHA');
      }

      // Fetch metadata
      const metadataRes = await axios.get(
        isPr
          ? `/github/pr/${owner}/${repo}/${id}`
          : `/github/commit/${owner}/${repo}/${id}`
      );
      
      // Fetch diff data
      const diffRes = await axios.get(
        isPr
          ? `/diff/pr/${owner}/${repo}/${id}`
          : `/diff/commit/${owner}/${repo}/${id}`
      );
      
      const data = {
        metadata: {
          ...metadataRes.data,
          owner,
          repo,
          ...(isPr ? { number: pr, pr } : { sha })
        },
        diff: diffRes.data,
        type: isPr ? 'pr' : 'commit'
      };
      
      console.log('📊 Diff data loaded:', {
        files: diffRes.data.files?.length,
        firstFile: diffRes.data.files?.[0],
        metadata: metadataRes.data.pr || metadataRes.data.commit || metadataRes.data.compare
      });
      
      setDiffData(data);
    } catch (err) {
      console.error('Error fetching diff:', err);
      setError(err.response?.data?.error || 'Failed to fetch diff data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <LoadingSpinner message="Loading diff data..." size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <h2>Error</h2>
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  // Use SmartDiffViewer for enhanced features or fallback to regular DiffViewer
  if (diffData.diff && diffData.diff.files) {
    return <SmartDiffViewer data={diffData} initialFilePath={initialFilePath} />;
  } else {
    // Fallback to original DiffViewer if data structure is different
    return <DiffViewer data={diffData} />;
  }
}

function CompareRoute() {
  const { owner, repo } = useParams();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search || '');
  const base = String(searchParams.get('base') || '').trim();
  const head = String(searchParams.get('head') || '').trim();

  const [diffData, setDiffData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchCompareData();
  }, [owner, repo, base, head]);

  const fetchCompareData = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!base || !head) {
        throw new Error('Missing base/head query params');
      }

      const metadataRes = await axios.get(`/github/compare/${owner}/${repo}`, {
        params: { base, head }
      });

      const diffRes = await axios.get(`/diff/compare/${owner}/${repo}`, {
        params: { base, head }
      });

      const data = {
        metadata: {
          ...metadataRes.data,
          owner,
          repo,
          title: `${owner}/${repo} ${base}...${head}`
        },
        diff: diffRes.data,
        type: 'compare'
      };

      setDiffData(data);
    } catch (err) {
      console.error('Error fetching compare:', err);
      setError(err.response?.data?.error || err.message || 'Failed to fetch compare data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <LoadingSpinner message="Loading compare diff..." size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <h2>Error</h2>
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  if (diffData?.diff && diffData.diff.files) {
    return <SmartDiffViewer data={diffData} />;
  }
  return <DiffViewer data={diffData} />;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <Router>
          <div className="app">
            <Routes>
              <Route path="/pr/:owner/:repo/:pr" element={<DiffViewerRoute />} />
              <Route path="/commit/:owner/:repo/:sha" element={<DiffViewerRoute />} />
              <Route path="/compare/:owner/:repo" element={<CompareRoute />} />
              <Route path="/" element={
                <div className="welcome-container">
                  <h2>Welcome to Advanced Diff Viewer</h2>
                  <p>Open a PR, commit, or branch compare from Agent Workspace to view diffs.</p>
                </div>
              } />
            </Routes>
          </div>
        </Router>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
