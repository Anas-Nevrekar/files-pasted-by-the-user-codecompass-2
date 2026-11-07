import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { useAuth } from './hooks/useAuth.js';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import LandingPage from './pages/LandingPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import AuthErrorPage from './pages/AuthErrorPage.jsx';
const RepositoryExplorerPage = lazy(() => import('./pages/RepositoryExplorerPage.jsx'));
function LandingGate() { const { status } = useAuth(); if (status === 'authenticated') return <Navigate to="/dashboard" replace/>; return <LandingPage/>; }
function AppRoutes() { return <Routes><Route path="/" element={<LandingGate/>}/><Route path="/dashboard" element={<ProtectedRoute><DashboardPage/></ProtectedRoute>}/><Route path="/repositories/:repositoryId" element={<ProtectedRoute><Suspense fallback={<div className="center-state" role="status">Loading repository explorer…</div>}><RepositoryExplorerPage/></Suspense></ProtectedRoute>}/><Route path="/auth/error" element={<AuthErrorPage/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes>; }
export default function App() { return <AuthProvider><AppRoutes/></AuthProvider>; }
