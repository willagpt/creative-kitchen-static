import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import Nav from './components/Nav'
import Login from './pages/Login'
import BrandSetup from './pages/BrandSetup'
import BrandDNA from './pages/BrandDNA'
import Templates from './pages/Templates'
import PromptLab from './pages/PromptLab'
import Generate from './pages/Generate'
import Review from './pages/Review'
import Upload from './pages/Upload'
import CompetitorAds from './pages/CompetitorAds'
import CompareAnalyses from './pages/CompareAnalyses'

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to="/competitor-ads" replace />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/brand-setup"
          element={
            <ProtectedRoute>
              <Nav />
              <BrandSetup />
            </ProtectedRoute>
          }
        />
        <Route
          path="/brand-dna"
          element={
            <ProtectedRoute>
              <Nav />
              <BrandDNA />
            </ProtectedRoute>
          }
        />
        <Route
          path="/templates"
          element={
            <ProtectedRoute>
              <Nav />
              <Templates />
            </ProtectedRoute>
          }
        />
        <Route
          path="/prompt-lab"
          element={
            <ProtectedRoute>
              <Nav />
              <PromptLab />
            </ProtectedRoute>
          }
        />
        <Route
          path="/generate"
          element={
            <ProtectedRoute>
              <Nav />
              <Generate />
            </ProtectedRoute>
          }
        />
        <Route
          path="/review"
          element={
            <ProtectedRoute>
              <Nav />
              <Review />
            </ProtectedRoute>
          }
        />
        <Route
          path="/upload"
          element={
            <ProtectedRoute>
              <Nav />
              <Upload />
            </ProtectedRoute>
          }
        />
        <Route
          path="/competitor-ads"
          element={
            <ProtectedRoute>
              <Nav />
              <CompetitorAds />
            </ProtectedRoute>
          }
        />
        <Route
          path="/compare"
          element={
            <ProtectedRoute>
              <Nav />
              <CompareAnalyses />
            </ProtectedRoute>
          }
        />
      </Routes>
    </>
  )
}
