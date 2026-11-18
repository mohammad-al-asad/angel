import React from 'react';
import PropTypes from 'prop-types';
import { useSelector } from 'react-redux';
import { Navigate, useLocation } from 'react-router-dom';

export default function ProtectedRoute({ children }) {
  const token = useSelector((state) => state?.auth?.token);
  const location = useLocation();

  if (!token) {
    return <Navigate to="/sign-in" replace state={{ from: location }} />;
  }

  return children;
}

ProtectedRoute.propTypes = {
  children: PropTypes.node,
};
