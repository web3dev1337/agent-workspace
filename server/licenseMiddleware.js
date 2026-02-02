function normalizeBool(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return false;
  return !['0', 'false', 'no', 'off'].includes(v);
}

function buildLicenseError(licenseService, { requiredPlan } = {}) {
  const status = licenseService.getStatus();
  const entitlements = licenseService.getEntitlements();
  const licensePath = licenseService.getLicensePath?.() || null;

  return {
    error: requiredPlan ? `License required: ${requiredPlan}` : 'License required',
    requiredPlan: requiredPlan || null,
    entitlements,
    status,
    licensePath
  };
}

function requirePro(licenseService) {
  return (req, res, next) => {
    try {
      const entitlements = licenseService.getEntitlements();
      if (entitlements?.pro) return next();
      res.status(402).json(buildLicenseError(licenseService, { requiredPlan: 'pro' }));
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to check license' });
    }
  };
}

function requireValidLicenseIfRequired(licenseService, { allowPaths = [] } = {}) {
  const allow = new Set(allowPaths);
  return (req, res, next) => {
    try {
      const required = normalizeBool(process.env.ORCHESTRATOR_LICENSE_REQUIRED);
      if (!required) return next();

      const path = String(req.path || '');
      if (allow.has(path)) return next();

      const status = licenseService.getStatus();
      if (status?.ok) return next();

      res.status(402).json(buildLicenseError(licenseService, { requiredPlan: 'valid' }));
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to check license' });
    }
  };
}

module.exports = { requirePro, requireValidLicenseIfRequired };

