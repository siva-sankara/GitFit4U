import { ArrowRight, ChevronRight, FileCheck2 } from "lucide-react";
import { Link } from "react-router-dom";
import {
  platformPolicyDocuments,
  policyDocumentByPath,
  type PlatformPolicyDocument,
} from "./policyDocuments";
import "../../styles/policies.css";

export type PublishedPlatformPolicy = Pick<
  PlatformPolicyDocument,
  "title" | "shortTitle" | "path" | "summary" | "effectiveDate" | "lastUpdated"
>;

export const publishedPlatformPolicies: readonly PublishedPlatformPolicy[] =
  platformPolicyDocuments;

export function TermsAndPoliciesPage() {
  return (
    <div className="container info-page policy-page">
      <nav className="policy-breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Home</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <span aria-current="page">Terms &amp; Policies</span>
      </nav>

      <span className="eyebrow">GETFIT4U platform policies</span>
      <h1>GETFIT4U Terms &amp; Policies</h1>
      <p className="info-lead">
        Review the rules for using GETFIT4U, how personal information is
        handled, payment and cancellation conditions, and how to request data
        deletion.
      </p>

      <aside className="policy-scope-note">
        These are GETFIT4U platform policies. Terms maintained by an individual
        gym in its Gym Profile Settings are separate and remain gym-specific.
      </aside>

      <section className="panel policy-index" aria-labelledby="published-policy-heading">
        <div className="policy-index-heading">
          <FileCheck2 size={24} aria-hidden="true" />
          <div>
            <h2 id="published-policy-heading">Published platform policies</h2>
            <p>Effective and update dates are shown on every document.</p>
          </div>
        </div>
        <ul className="policy-links">
          {publishedPlatformPolicies.map((policy) => (
            <li key={policy.path}>
              <Link to={policy.path}>
                <span>
                  <strong>{policy.shortTitle}</strong>
                  <small>{policy.summary}</small>
                  <small>
                    Effective {policy.effectiveDate} · Updated {policy.lastUpdated}
                  </small>
                </span>
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <p className="policy-contact">
        For questions, requests, or current support options, visit the{" "}
        <Link to="/contact">Contact page</Link>.
      </p>
    </div>
  );
}

export function PolicyDocumentPage({
  path,
}: {
  path: PlatformPolicyDocument["path"];
}) {
  const document = policyDocumentByPath.get(path);
  if (!document) return null;

  return (
    <div className="container info-page policy-page policy-document-page">
      <nav className="policy-breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Home</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <Link to="/terms-and-policies">Terms &amp; Policies</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <span aria-current="page">{document.shortTitle}</span>
      </nav>

      <header className="policy-document-header">
        <span className="eyebrow">GETFIT4U platform policy</span>
        <h1>{document.title}</h1>
        <p className="info-lead">{document.summary}</p>
        <dl className="policy-dates" aria-label="Document dates">
          <div>
            <dt>Effective</dt>
            <dd>{document.effectiveDate}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>{document.lastUpdated}</dd>
          </div>
        </dl>
      </header>

      <div className="policy-document-layout">
        <aside className="panel policy-toc" aria-labelledby="policy-toc-heading">
          <h2 id="policy-toc-heading">On this page</h2>
          <ol>
            {document.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title.replace(/^\d+\.\s*/, "")}</a>
              </li>
            ))}
          </ol>
        </aside>

        <article className="policy-document">
          {document.sections.map((section) => (
            <section id={section.id} key={section.id} tabIndex={-1}>
              <h2>{section.title}</h2>
              {section.paragraphs?.map((paragraph, index) => (
                <p key={`${section.id}-paragraph-${index}`}>{paragraph}</p>
              ))}
              {section.items && (
                <ul>
                  {section.items.map((item, index) => (
                    <li key={`${section.id}-item-${index}`}>{item}</li>
                  ))}
                </ul>
              )}
              {section.note && <aside className="policy-note">{section.note}</aside>}
            </section>
          ))}
        </article>
      </div>

      <nav className="policy-document-footer" aria-label="Policy navigation">
        <Link to="/terms-and-policies">View all Terms &amp; Policies</Link>
        <Link to="/contact">Contact GETFIT4U</Link>
      </nav>
    </div>
  );
}
