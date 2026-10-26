import { Navigate, useLocation } from 'react-router';

export function RequireSignIn() {
  const location = useLocation();
  return (
    <Navigate
      to="/sign-in"
      state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      replace
    />
  );
}
