from pathlib import Path

import numpy as np

from src.data.preprocessing import (
    find_image,
    preprocess_image
)


def load_data(
    dataframe,
    image_dirs,
    image_size=(224, 224)
):
    """
    Load HAM10000 images and labels.

    Parameters
    dataframe : pandas.DataFrame
        DataFrame containing image_id and dx columns.

    image_dirs : list
        List containing HAM10000 image directories.

    image_size : tuple
        Target image size.

    Returns
    images : numpy.ndarray
        Preprocessed images.

    labels : numpy.ndarray
        Corresponding diagnosis labels.
    """

    images = []
    labels = []

    for _, row in dataframe.iterrows():

        image_id = row["image_id"]

        image_path = find_image(
            image_id,
            image_dirs
        )

        if image_path is None:
            continue

        image = preprocess_image(
            image_path,
            image_size=image_size
        )

        images.append(image)
        labels.append(row["dx"])

    return (
        np.asarray(images, dtype=np.float32),
        np.asarray(labels)
    )