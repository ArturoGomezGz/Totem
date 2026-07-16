import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, Float, ForeignKey, String, Text, TIMESTAMP
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from db import Base

TIMESTAMPTZ = TIMESTAMP(timezone=True)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMPTZ, nullable=False)


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMPTZ, nullable=False)


class Membership(Base):
    __tablename__ = "memberships"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), primary_key=True)
    role: Mapped[str] = mapped_column(String, nullable=False)
    joined_at: Mapped[datetime] = mapped_column(TIMESTAMPTZ, nullable=False)


class Unit(Base):
    __tablename__ = "units"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    api_key: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    firmware_version: Mapped[Optional[str]] = mapped_column(String)
    target_firmware_release_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("firmware_releases.id")
    )
    last_seen: Mapped[Optional[datetime]] = mapped_column(TIMESTAMPTZ)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMPTZ, nullable=False)


class IrrigationMethod(Base):
    """Catálogo de métodos de riego (fixed_timer, vpd_threshold, ...). No es
    privado por organización — es taxonomía del sistema. `params_schema` es
    un JSON Schema que valida `crop_profiles.irrigation_params` para perfiles
    que usan este método."""

    __tablename__ = "irrigation_methods"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    params_schema: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMPTZ, nullable=False)


class CropProfile(Base):
    __tablename__ = "crop_profiles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    species: Mapped[Optional[str]] = mapped_column(String)
    temp_min: Mapped[Optional[float]] = mapped_column(Float)
    temp_max: Mapped[Optional[float]] = mapped_column(Float)
    humidity_min: Mapped[Optional[float]] = mapped_column(Float)
    humidity_max: Mapped[Optional[float]] = mapped_column(Float)
    light_min: Mapped[Optional[float]] = mapped_column(Float)
    light_max: Mapped[Optional[float]] = mapped_column(Float)
    irrigation_method: Mapped[str] = mapped_column(String, ForeignKey("irrigation_methods.key"), nullable=False)
    irrigation_params: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMPTZ, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMPTZ, nullable=False)


class TotemConfig(Base):
    __tablename__ = "totem_configs"

    unit_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("units.id"), primary_key=True)
    active_profile_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("crop_profiles.id"))


class Reading(Base):
    __tablename__ = "readings"

    unit_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("units.id"), primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(TIMESTAMPTZ, primary_key=True)
    temperature: Mapped[Optional[float]] = mapped_column(Float)
    humidity: Mapped[Optional[float]] = mapped_column(Float)
    light: Mapped[Optional[float]] = mapped_column(Float)
    # Sensores de gas (fase de prueba, solo monitoreo). Conteo crudo del ADC
    # sin calibrar, igual criterio que `light`. NULL = la unidad no tiene el
    # sensor. air_quality: Grove Air Quality v1.3; methane: MQ-4 (salida AO).
    air_quality: Mapped[Optional[float]] = mapped_column(Float)
    methane: Mapped[Optional[float]] = mapped_column(Float)
    # co2: Senseair S8 (NDIR) por UART. A diferencia de los otros gases, NO es
    # conteo crudo del ADC — son ppm ya CALIBRADOS por el sensor. Solo monitoreo
    # (no alimenta la decisión de riego, que sigue siendo por VPD).
    co2: Mapped[Optional[float]] = mapped_column(Float)


class DeviceEvent(Base):
    __tablename__ = "device_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    unit_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("units.id"), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(TIMESTAMPTZ, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    trigger: Mapped[str] = mapped_column(String, nullable=False)
    # Duración (s) del tramo que cierra el evento: pump_off = tiempo bombeando,
    # valve_close = tiempo de llenado. NULL en eventos de apertura y en históricos
    # previos a firmware 1.4.2. La mide el firmware con precisión de microsegundos.
    duration_s: Mapped[Optional[float]] = mapped_column(Float)


class Command(Base):
    __tablename__ = "commands"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    unit_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("units.id"), nullable=False)
    issued_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[Optional[dict]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMPTZ, nullable=False)
    delivered_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMPTZ)


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    unit_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("units.id"), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(TIMESTAMPTZ, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    severity: Mapped[str] = mapped_column(String, nullable=False)
    message: Mapped[Optional[str]] = mapped_column(Text)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMPTZ)
    telegram_sent_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMPTZ)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    token_hash: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(TIMESTAMPTZ, nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMPTZ)


class FirmwareRelease(Base):
    __tablename__ = "firmware_releases"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False)
    version: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    binary_path: Mapped[str] = mapped_column(String, nullable=False)
    sha256: Mapped[str] = mapped_column(String, nullable=False)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    released_at: Mapped[datetime] = mapped_column(TIMESTAMPTZ, nullable=False)
    supported_irrigation_methods: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)


class TelegramUser(Base):
    __tablename__ = "telegram_users"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    chat_id: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    linked_at: Mapped[datetime] = mapped_column(TIMESTAMPTZ, nullable=False)


class TelegramLinkToken(Base):
    __tablename__ = "telegram_link_tokens"

    token: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(TIMESTAMPTZ, nullable=False)
    used_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMPTZ)
