export default function BrandLogo({
  subtitle,
  titleClassName = 'text-xl',
  subtitleClassName = 'text-xs text-gray-500',
  iconClassName = 'text-2xl',
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={iconClassName} aria-hidden="true">
        🛡️
      </span>
      <div>
        <p className={`font-bold text-blue-600 tracking-tight ${titleClassName}`}>CrowdSafe</p>
        {subtitle ? <p className={subtitleClassName}>{subtitle}</p> : null}
      </div>
    </div>
  );
}

