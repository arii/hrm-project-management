import React, { useState } from 'react';
import { Mail, Shield, Scale, Globe, ArrowUpRight, Rss, X } from 'lucide-react';

export default function Footer() {
  const [activeModal, setActiveModal] = useState<'contact' | 'terms' | 'privacy' | null>(null);

  const closeModal = () => setActiveModal(null);

  return (
    <footer className="mt-auto border-t border-slate-800 bg-slate-950/20 py-12 px-6 lg:px-8">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
        {/* Branding & Attribution */}
        <div className="flex flex-col items-center md:items-start text-center md:text-left space-y-2">
          <p className="text-slate-300 font-semibold text-sm">
            RepoAuditor AI v2.0
          </p>
          <p className="text-xs text-slate-500">
            DevAI Agent Orchestration • Crafted by{' '}
            <a 
              href="https://arii.github.io" 
              className="text-indigo-400 hover:underline font-medium hover:text-indigo-300 transition-colors inline-flex items-center gap-0.5"
              target="_blank" 
              rel="noopener noreferrer"
            >
              Ariel Anders PhD
              <ArrowUpRight className="w-3 h-3" />
            </a>
          </p>
        </div>

        {/* Navigation Links */}
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          <button 
            onClick={() => setActiveModal('contact')} 
            className="hover:text-indigo-400 transition-colors flex items-center gap-1.5"
          >
            <Mail className="w-3.5 h-3.5 text-indigo-400/80" />
            Contact
          </button>
          
          <button 
            onClick={() => setActiveModal('terms')} 
            className="hover:text-indigo-400 transition-colors flex items-center gap-1.5"
          >
            <Scale className="w-3.5 h-3.5 text-indigo-400/80" />
            Terms of Use
          </button>
          
          <button 
            onClick={() => setActiveModal('privacy')} 
            className="hover:text-indigo-400 transition-colors flex items-center gap-1.5"
          >
            <Shield className="w-3.5 h-3.5 text-indigo-400/80" />
            Privacy Policy
          </button>

          <a 
            href="https://boomtick.blog" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="hover:text-indigo-400 transition-colors flex items-center gap-1.5"
          >
            <Rss className="w-3.5 h-3.5 text-indigo-400/80" />
            boomtick.blog
          </a>
        </div>
      </div>

      {/* Modals for Footer Info */}
      {activeModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl animate-in fade-in zoom-in duration-200">
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                {activeModal === 'contact' && <Mail className="w-5 h-5 text-indigo-400" />}
                {activeModal === 'terms' && <Scale className="w-5 h-5 text-indigo-400" />}
                {activeModal === 'privacy' && <Shield className="w-5 h-5 text-indigo-400" />}
                {activeModal === 'contact' && 'Contact & Collaboration'}
                {activeModal === 'terms' && 'Terms of Use'}
                {activeModal === 'privacy' && 'Privacy Policy'}
              </h3>
              <button 
                onClick={closeModal} 
                className="text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-full p-1.5 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto space-y-4 text-sm text-slate-300 leading-relaxed no-scrollbar flex-1">
              {activeModal === 'contact' && (
                <div className="space-y-4">
                  <p>
                    RepoAuditor AI is powered by the <strong>LoopMarshal DevAI orchestration engine</strong>. For issues, architectural collaboration, or system queries, please reach out directly:
                  </p>
                  <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-3">
                    <p className="flex items-center gap-3">
                      <span className="font-semibold text-slate-400 w-20">Developer:</span>
                      <span className="text-white">Ariel Anders PhD</span>
                    </p>
                    <p className="flex items-center gap-3">
                      <span className="font-semibold text-slate-400 w-20">Email:</span>
                      <a href="mailto:anders.ariel@gmail.com" className="text-indigo-400 hover:underline">
                        anders.ariel@gmail.com
                      </a>
                    </p>
                    <p className="flex items-center gap-3">
                      <span className="font-semibold text-slate-400 w-20">Portfolio:</span>
                      <a 
                        href="https://arii.github.io" 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-indigo-400 hover:underline inline-flex items-center gap-1"
                      >
                        arii.github.io <ArrowUpRight className="w-3.5 h-3.5" />
                      </a>
                    </p>
                    <p className="flex items-center gap-3">
                      <span className="font-semibold text-slate-400 w-20">Blog & RSS:</span>
                      <a 
                        href="https://boomtick.blog" 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-indigo-400 hover:underline inline-flex items-center gap-1"
                      >
                        boomtick.blog <ArrowUpRight className="w-3.5 h-3.5" />
                      </a>
                    </p>
                  </div>
                  <p>
                    Whether modifying code streams with the Jules suite or optimizing continuous integration log diagnostic flows, we'd love to hear how you configure the console in production!
                  </p>
                </div>
              )}

              {activeModal === 'terms' && (
                <div className="space-y-4">
                  <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Last updated: May 2026</p>
                  <p>
                    By using <strong>RepoAuditor AI</strong> (live at repo-auditor-ai.vercel.app or in localized preview containers), you agree to the following terms:
                  </p>
                  <h4 className="font-bold text-white text-base">1. Zero Retention Brokerage</h4>
                  <p>
                    The platform never transacts personal tokens, repository write-actions, or execution metadata to a cloud back-end. All transactions are negotiated directly inside your browser client loop via local variables. Consequently, developers are solely responsible for protecting their personal access tokens and authorization scopes.
                  </p>
                  <h4 className="font-bold text-white text-base">2. Autonomous Actions Notice</h4>
                  <p>
                    This application utilizes powerful Large Language Models (specifically Gemini) to suggest issues, review pull-request modifications, and propose commits. Any programmatic write operation submitted back to GitHub (e.g. posting PR comments, patching lines of code through active Jules agents) must be peer-reviewed by the user before committing.
                  </p>
                  <h4 className="font-bold text-white text-base">3. Disclaimer of Direct Liability</h4>
                  <p>
                    RepoAuditor AI is provided "as is", without warranty of any kind, express or implied. The author, Ariel Anders, PhD, is not liable for runtime CI failures, incorrect line repairs, or token security compromise occurring outside our control.
                  </p>
                </div>
              )}

              {activeModal === 'privacy' && (
                <div className="space-y-4">
                  <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Last updated: May 2026</p>
                  <p>
                    Privacy is a core structural constraint of <strong>RepoAuditor AI</strong>. We respect your enterprise code repositories and maintain a completely transparent stance:
                  </p>
                  <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-2">
                    <p className="text-green-400 font-semibold text-xs uppercase tracking-widest">✓ No Database Storage</p>
                    <p className="text-slate-300">We do not operate remote databases to store your API credentials.</p>
                    
                    <p className="text-green-400 font-semibold text-xs uppercase tracking-widest mt-3">✓ Local Browser Isolation</p>
                    <p className="text-slate-300">Your GitHub personal access keys (PATs), Google Gemini keys, and Jules active tokens are strictly held in the browser's local sandbox storage (<code>localStorage</code>).</p>
                    
                    <p className="text-green-400 font-semibold text-xs uppercase tracking-widest mt-3">✓ Peer-to-Peer Telemetry</p>
                    <p className="text-slate-300">Requests flow peer-to-peer straight from the browser to public Google Cloud and GitHub endpoints. When failing over via Edge frameworks, payload data is brokered temporarily and immediately discarded from memory (Zero Audit Logging).</p>
                  </div>
                  <p>
                    No tracking cookies, no Google Analytics tracking IDs, and no telemetry tracking networks are included or executed in this console.
                  </p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-800 flex justify-end">
              <button 
                onClick={closeModal} 
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </footer>
  );
}
