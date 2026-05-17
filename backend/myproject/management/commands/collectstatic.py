"""
Override django-cloudinary-storage's collectstatic command.
Uses Django's original collectstatic instead of cloudinary-storage's broken one.
"""
from django.contrib.staticfiles.management.commands import collectstatic as original_collectstatic


class Command(original_collectstatic.Command):
    """Use Django's native collectstatic, bypassing cloudinary_storage."""
    pass