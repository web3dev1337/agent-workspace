import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useParams } from 'react-router-dom';
import DiffViewer from './components/DiffViewer';
import ErrorBoundary from './components/ErrorBoundary';
import LoadingSpinner from './components/LoadingSpinner';
import axios from 'axios';
import './styles/App.css';

// Configure axios defaults
axios.defaults.baseURL = '/api';

function DiffViewerRoute() {
  const { owner, repo, pr } = useParams();
  const [diffData, setDiffData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchDiffData();
  }, [owner, repo, pr]);

  const fetchDiffData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Fetch PR metadata
      const metadataRes = await axios.get(`/github/pr/${owner}/${repo}/${pr}`);
      
      // Fetch diff data
      const diffRes = await axios.get(`/diff/pr/${owner}/${repo}/${pr}`);
      
      setDiffData({
        metadata: metadataRes.data,
        diff: diffRes.data,
        type: pr ? 'pr' : 'commit'
      });
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

  return <DiffViewer data={diffData} />;
}

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <div className="app">
          <header className="app-header">
            <h1>Advanced Git Diff Viewer</h1>
            <div className="header-subtitle">
              Semantic diffs powered by AST analysis
            </div>
          </header>
          
          <Routes>
            <Route path="/pr/:owner/:repo/:pr" element={<DiffViewerRoute />} />
            <Route path="/commit/:owner/:repo/:sha" element={<DiffViewerRoute />} />
            <Route path="/" element={
              <div className="welcome-container">
                <h2>Welcome to Advanced Diff Viewer</h2>
                <p>Open a PR or commit from Claude Orchestrator to view diffs.</p>
              </div>
            } />
          </Routes>
        </div>
      </Router>
    </ErrorBoundary>
  );
}

export default App;