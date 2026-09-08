import React, { useEffect } from 'react';

export interface BreadcrumbItem {
  name: string;
  path: string;
}

export interface SEOProps {
  title: string;
  description: string;
  keywords?: string;
  canonical?: string;
  breadcrumbs?: BreadcrumbItem[];
  schema?: Record<string, any> | Array<Record<string, any>>;
  type?: 'website' | 'article' | 'application';
}

const DEFAULT_ORIGIN = typeof window !== 'undefined' ? window.location.origin : 'https://repo-auditor-ai.vercel.app';

export const SEO: React.FC<SEOProps> = ({
  title,
  description,
  keywords,
  canonical,
  breadcrumbs,
  schema,
  type = 'application'
}) => {
  useEffect(() => {
    // 1. Update Document Title
    const fullTitle = title.includes('RepoAuditor AI') ? title : `${title} | RepoAuditor AI`;
    document.title = fullTitle;

    // Helper to update or create meta tags
    const setMeta = (selector: string, attribute: string, attrValue: string, content: string) => {
      let element = document.querySelector(selector) as HTMLMetaElement | null;
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute(attribute, attrValue);
        document.head.appendChild(element);
      }
      element.setAttribute('content', content);
    };

    // 2. Primary Meta Tags
    setMeta('meta[name="description"]', 'name', 'description', description);
    if (keywords) {
      setMeta('meta[name="keywords"]', 'name', 'keywords', keywords);
    }

    // 3. Open Graph Tags
    setMeta('meta[property="og:title"]', 'property', 'og:title', fullTitle);
    setMeta('meta[property="og:description"]', 'property', 'og:description', description);
    setMeta('meta[property="og:type"]', 'property', 'og:type', type);
    
    // 4. Twitter Tags
    setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', fullTitle);
    setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description);

    // 5. Canonical Link
    const targetUrl = canonical || (typeof window !== 'undefined' ? window.location.href : DEFAULT_ORIGIN);
    let canonicalLink = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (canonicalLink) {
      canonicalLink.setAttribute('href', targetUrl);
    }

    // 6. Structured Data (JSON-LD)
    const scriptId = 'page-structured-data';
    let scriptTag = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (!scriptTag) {
      scriptTag = document.createElement('script');
      scriptTag.id = scriptId;
      scriptTag.type = 'application/ld+json';
      document.head.appendChild(scriptTag);
    }

    // Assemble structured data graphs
    const schemaList: any[] = [];

    // Add breadcrumb list if supplied
    if (breadcrumbs && breadcrumbs.length > 0) {
      schemaList.push({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: breadcrumbs.map((crumb, idx) => ({
          '@type': 'ListItem',
          position: idx + 1,
          name: crumb.name,
          item: crumb.path.startsWith('http') ? crumb.path : `${DEFAULT_ORIGIN}/#${crumb.path}`
        }))
      });
    }

    // Add custom schema(s)
    if (schema) {
      if (Array.isArray(schema)) {
        schema.forEach((s) => {
          schemaList.push({
            '@context': 'https://schema.org',
            ...s
          });
        });
      } else {
        schemaList.push({
          '@context': 'https://schema.org',
          ...schema
        });
      }
    }

    if (schemaList.length > 0) {
      scriptTag.text = JSON.stringify(schemaList.length === 1 ? schemaList[0] : {
        '@context': 'https://schema.org',
        '@graph': schemaList
      }, null, 2);
    }
  }, [title, description, keywords, canonical, breadcrumbs, schema, type]);

  return null;
};

export default SEO;
