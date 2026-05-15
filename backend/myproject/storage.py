from whitenoise.storage import CompressedManifestStaticFilesStorage

class IgnoreMissingFilesManifestStaticFilesStorage(CompressedManifestStaticFilesStorage):
    def hashed_name(self, name, content=None, filename=None):
        try:
            return super().hashed_name(name, content, filename)
        except ValueError:
            # This is raised by Whitenoise/ManifestFilesMixin when a file is missing
            return name
