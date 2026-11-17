from pathlib import Path

import numpy as np
from PIL import Image


IMAGE_SIZE = (224, 224)


def find_image(image_id, image_dirs):
    """
    Find a HAM10000 image in either image directory.
    """

    for image_dir in image_dirs:
        image_path = Path(image_dir) / f"{image_id}.jpg"

        if image_path.exists():
            return image_path

    return None


def preprocess_image(image_path, image_size=IMAGE_SIZE):
    """
    Load an image, convert it to RGB, resize it,
    and normalize pixel values to [0, 1].
    """

    image = Image.open(image_path).convert("RGB")

    image = image.resize(image_size)

    image_array = np.asarray(
        image,
        dtype=np.float32
    )

    image_array /= 255.0

    return image_array