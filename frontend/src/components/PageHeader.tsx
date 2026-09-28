import { useContext, type HTMLAttributes } from "react";
import { WorkspaceBreadcrumbs } from "./WorkspaceBreadcrumbs";
import { PageNavigationContext } from "./pageNavigation";
import "../styles/compact-layout.css";

/** Keep page navigation beside the real heading instead of adding a second title row. */
export function PageHeader({ children, className = "", ...props }: HTMLAttributes<HTMLElement>) {
  const navigation = useContext(PageNavigationContext);
  return <header {...props} className={`page-heading shared-page-heading ${className}`}>
    {navigation && <WorkspaceBreadcrumbs {...navigation} />}
    {children}
  </header>;
}
