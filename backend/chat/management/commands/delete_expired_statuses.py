from django.core.management.base import BaseCommand
from chat.models import Status
from django.utils import timezone
from datetime import timedelta

class Command(BaseCommand):
    help = 'Delete statuses older than 12 hours'

    def handle(self, *args, **kwargs):
        cutoff = timezone.now() - timedelta(hours=12)
        expired = Status.objects.filter(created_at__lt=cutoff)
        count = 0
        for s in expired:
            try:
                s.delete()
                count += 1
            except Exception as e:
                self.stdout.write(self.style.ERROR(f"Error deleting status {s.id}: {e}"))
        self.stdout.write(self.style.SUCCESS(f'Deleted {count} expired statuses.'))
