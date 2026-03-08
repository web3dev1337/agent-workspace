import re

with open('client/app.js', 'r') as f:
    content = f.read()

# We need to replace the innerHTML block inside 'const render = () => {'
# Let's find: `listEl.innerHTML = \`` up to the closing `\`;`
pattern = r'(listEl\.innerHTML\s*=\s*`)(.*?)(`;\n\n\s*return\s*\{\s*req,\s*steps,\s*current\s*\};\n\s*\};)'
match = re.search(pattern, content, re.DOTALL)

if not match:
    print("Could not find listEl.innerHTML block!")
else:
    new_html = """
	        <div class="onboarding-stepper-row">
	          ${steps.map((step, idx) => {
	            const isActive = idx === state.currentStep;
	            const isDone = step.done;
	            let statusClass = 'stepper-upcoming';
	            if (isDone) statusClass = 'stepper-done';
	            if (isActive) statusClass = 'stepper-active';
	            return `
	              <div class="onboarding-stepper-item ${statusClass}" title="${this.escapeHtml(step.title)}">
	                <div class="stepper-icon-box">
	                  ${isActive ? `<span class="stepper-active-label">Step ${stepNo}</span>` : ''}
	                  <div class="stepper-diamond"></div>
	                </div>
	              </div>
	            `;
	          }).join('')}
	        </div>
	        
	        <div class="onboarding-step-card ${current?.done ? 'card-done' : ''}" data-setup-item="${this.escapeHtml(currentId)}">
	          <div class="onboarding-step-icon">
	            <div class="onboarding-main-icon"></div>
	          </div>
	          <div class="onboarding-step-content">
	            <h3 class="onboarding-step-title">${currentTitle}</h3>
	            
	            <div class="onboarding-step-status-row">
	              ${current?.done ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="onboarding-check"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
	              <p class="onboarding-step-desc">${currentDesc} ${statusText ? `<span class="onboarding-inline-status ${statusClass}">(${statusText})</span>` : ''}</p>
	            </div>
	            
	            ${isGitIdentityStep ? `
	              <div class="dependency-git-identity-helper">
	                <div class="dependency-git-identity-fields">
	                  <label class="dependency-git-identity-field">
	                    <span>Name</span>
	                    <input type="text" data-setup-git-name placeholder="Jane Developer" autocomplete="name" value="${gitIdentityName}" ${isRunBusy ? 'disabled' : ''}>
	                  </label>
	                  <label class="dependency-git-identity-field">
	                    <span>Email</span>
	                    <input type="email" data-setup-git-email placeholder="you@example.com" autocomplete="email" value="${gitIdentityEmail}" ${isRunBusy ? 'disabled' : ''}>
	                  </label>
	                  <button class="onboarding-btn-secondary" type="button" data-setup-git-save="true" ${isRunBusy ? 'disabled' : ''}>${isRunBusy ? 'Saving...' : (current?.done ? 'Update identity' : 'Save identity')}</button>
	                </div>
	              </div>
	            ` : ''}
	            
	            ${isGhLoginStep && !current?.done ? `
	              <div class="dependency-gh-login-helper">
	                ${ghLoginUiPhase === 'start' ? '<div class="dependency-gh-login-helper-text">Click <strong>Start login</strong> on the right to authenticate via GitHub.</div>' : ''}
	                ${ghLoginUiPhase === 'wait-code' ? '<div class="dependency-gh-login-helper-text">Waiting for one-time code from GitHub CLI...</div>' : ''}
	                ${ghLoginUiPhase === 'code' ? `<div class="dependency-gh-login-helper-text">Click <strong>Open GitHub login</strong> and paste this code.</div><div class="dependency-gh-login-code-wrap"><span class="dependency-gh-login-code mono">${this.escapeHtml(ghLoginCode)}</span><button class="onboarding-btn-secondary" type="button" data-setup-copy-gh-code="${this.escapeHtml(ghLoginCode)}">Copy code</button></div>` : ''}
	              </div>
	            ` : ''}
	            
	            ${shouldShowInstallerOutput ? `
	              <div class="dependency-onboarding-command-wrap">
	                <pre class="mono dependency-setup-item-output">${installerOutputText}</pre>
	              </div>
	            ` : ''}
	            
	            ${command && !isGhLoginStep && !isGitIdentityStep && !current?.done ? `
	              <div class="dependency-onboarding-command-wrap">
	                <pre class="mono dependency-setup-item-command">${command}</pre>
	              </div>
	            ` : ''}
                
                <div class="onboarding-step-actions">
                  ${showRunButton ? `<button class="onboarding-btn-secondary" type="button" data-setup-run="${this.escapeHtml(currentId)}" ${runDisabled ? 'disabled' : ''}>${runLabel}</button>` : ''}
                  ${!isGhLoginStep && !isGitIdentityStep ? `<button class="onboarding-btn-secondary" type="button" data-setup-copy-id="${this.escapeHtml(currentId)}" ${commandRaw ? '' : 'disabled'}>Copy command</button>` : ''}
                  ${isGhLoginStep && !current?.done && ghLoginUiPhase === 'code' ? `<button class="onboarding-btn-secondary" type="button" data-setup-open-gh-login="${this.escapeHtml(ghLoginLink)}">Open GitHub login</button>` : ''}
                </div>
	          </div>
	        </div>
	        
	        <div class="onboarding-nav-row">
	          <button class="onboarding-btn-back" type="button" data-setup-prev="true" ${state.currentStep <= 0 ? 'disabled' : ''}>Back</button>
	          <button class="onboarding-btn-primary" type="button" data-setup-next="true" ${canAdvance ? '' : 'disabled'}>${nextLabel}</button>
	        </div>"""
    
    new_content = content[:match.start(2)] + new_html + content[match.start(3):]
    with open('client/app.js', 'w') as f:
        f.write(new_content)
    print("Successfully patched client/app.js")
