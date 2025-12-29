---
name: security-review
description: Security-focused code review guidelines for identifying vulnerabilities
---

## When to Apply This Skill

This skill should be loaded when the PR touches:
- Authentication or authorisation logic
- Cryptography or secrets handling
- Database queries or data access layers
- API endpoints or request handlers
- Dependency files (package.json, requirements.txt, go.mod, etc.)
- Configuration that may contain sensitive values
- File upload/download functionality
- User input processing or validation

## Input Validation Vulnerabilities

**SQL Injection**
- Are queries parameterised or using prepared statements?
- Is user input ever concatenated directly into SQL strings?
- Are ORM methods being used correctly, or is raw SQL being injected unsafely?

**Cross-Site Scripting (XSS)**
- Is user-provided content properly escaped before rendering in HTML?
- Are there any uses of `innerHTML`, `dangerouslySetInnerHTML`, or template literals that bypass escaping?
- Is content from URLs, query parameters, or local storage treated as untrusted?

**Command Injection**
- Is user input passed to shell commands, system calls, or exec functions?
- Are arguments properly escaped or, better yet, passed as arrays rather than strings?

**Path Traversal**
- Can user input influence file paths?
- Are there protections against `../` sequences or absolute paths?
- Is there a whitelist of allowed directories?

**Server-Side Request Forgery (SSRF)**
- Can user input control URLs that the server fetches?
- Are there protections against internal network access, localhost, or cloud metadata endpoints?

## Authentication and Authorisation

**Authentication**
- Are passwords hashed with a strong, slow algorithm (bcrypt, scrypt, Argon2)?
- Is there protection against timing attacks in password comparison?
- Are session tokens generated with cryptographically secure randomness?
- Is token expiry and rotation handled correctly?

**Authorisation**
- Is every endpoint or action checking the user's permissions?
- Could a user access or modify resources belonging to another user?
- Are admin/privileged actions properly gated?
- Is there defence in depth (checking permissions at multiple layers)?

**Session Management**
- Are sessions invalidated on logout?
- Is session fixation prevented (regenerating session ID on login)?
- Are cookies marked as HttpOnly, Secure, and SameSite where appropriate?

## Data Protection

**Sensitive Data Exposure**
- Are passwords, tokens, or API keys being logged?
- Is PII (personally identifiable information) exposed in error messages, URLs, or logs?
- Are sensitive fields excluded from serialisation (e.g., `toJSON` methods)?

**Secrets Management**
- Are secrets hardcoded in the source, or properly loaded from environment or secrets managers?
- Are secrets accidentally included in client-side bundles?
- Are .env files or secret config files excluded from version control?

**Encryption**
- Is sensitive data encrypted at rest where required?
- Is TLS used for all external communications?
- Are cryptographic algorithms current and not deprecated (no MD5, SHA1 for security purposes)?

## Dependency Security

**New Dependencies**
- Is the new dependency well-maintained and from a reputable source?
- Does it have known vulnerabilities? (Check with `npm audit`, `pip audit`, or similar)
- Is it pulling in a large transitive dependency tree that increases attack surface?
- Does it require excessive permissions for its stated purpose?

**Dependency Updates**
- Are security patches applied promptly?
- Is there a lockfile to ensure reproducible builds?
- Are dependencies pinned to specific versions or ranges?

## Architecture and Design

**Trust Boundaries**
- Is input from external systems (APIs, message queues, files) validated?
- Are there clear boundaries between trusted and untrusted contexts?

**Attack Surface**
- Does this change expose new endpoints or functionality?
- Are unused or deprecated endpoints being removed?
- Is there rate limiting or abuse protection for public-facing features?

**Defence in Depth**
- Is security relying on a single control that could fail?
- Are there multiple layers of protection?

**Fail-Safe Defaults**
- Does the code fail securely if something goes wrong?
- Are permissions denied by default rather than granted?
- Is there appropriate error handling that doesn't leak information?

## Common Vulnerability Patterns (OWASP Top 10)

Keep an eye out for:

1. **Broken Access Control** - missing or inconsistent permission checks
2. **Cryptographic Failures** - weak algorithms, improper key management, missing encryption
3. **Injection** - SQL, command, LDAP, or expression language injection
4. **Insecure Design** - fundamental architectural flaws, missing threat modelling
5. **Security Misconfiguration** - default credentials, unnecessary features enabled, verbose errors
6. **Vulnerable Components** - outdated dependencies with known CVEs
7. **Authentication Failures** - weak password policies, missing MFA, session issues
8. **Data Integrity Failures** - unsigned updates, insecure deserialisation
9. **Logging Failures** - missing audit logs, exposed sensitive data in logs
10. **SSRF** - unvalidated URLs fetched by the server

## Language-Specific Concerns

**JavaScript/TypeScript**
- Prototype pollution in object merging
- `eval()` or `Function()` with user input
- Regex denial of service (ReDoS)
- Insecure use of `JSON.parse()` on untrusted input

**Python**
- Pickle deserialisation of untrusted data
- `eval()` or `exec()` with user input
- YAML `load()` vs `safe_load()`
- Template injection in Jinja2 or similar

**Go**
- Unchecked errors that could lead to security bypasses
- Race conditions in goroutines
- Integer overflow in 32-bit contexts

**Java**
- Deserialisation vulnerabilities
- XML External Entity (XXE) injection
- SQL injection via string concatenation

## Writing Security Comments

When raising security concerns:

- Be specific about the vulnerability type and potential impact
- Explain how an attacker might exploit the issue
- Suggest a concrete remediation
- For serious issues, make it clear this should be addressed before merging
- If you're uncertain, phrase it as a question: "Could this be vulnerable to X if...?"
